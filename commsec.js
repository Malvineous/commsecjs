'use strict';

var Request = require('request');
var Promise = require('promise');
var Broker = require('./base.js');

/// Internal function used by retry().
function attempt(count, fn, fulfill, reject)
{
	new Promise(fn).then(function(f) {
		fulfill(f);
	}, function(err) {
		if (count <= 1) {
			reject(err);
		} else {
			attempt(count - 1, fn, fulfill, reject);
		}
	});
}

/// Retry the given function count times.
function retry(count, fn) {
	return new Promise(function(fulfill, reject) {
		attempt(count, fn, fulfill, reject);
	});
}

class CommsecBroker extends Broker
{
	constructor() {
		super();
		this.cookiejar = Request.jar();
		this.connected = false;
	}

	fill_prices(stocks) {
		var self = this;
		return this.cs_connect_if_needed()
			.then(function() {
				// This call is wrapped in a function() so it's called after we are
				// connected (in the 'then' phase), rather than as an immediate call at
				// the time the then() is being set up.
				return self.cs_get_market_data(stocks);
			})
		;
	}

	buy(order) {
		var self = this;
		return this.cs_connect_if_needed()
			.then(function() {
				return self.cs_place_order('Buy', order);
			})
		;
	}

	sell(order) {
		var self = this;
		return this.cs_connect_if_needed()
			.then(function() {
				return self.cs_place_order('Sell', order);
			})
		;
	}

	/// Convert JavaScript objects into JSON.
	/**
	 * This is needed because CommSec returns stock prices as a JavaScript object,
	 * which would have to be eval()'d.  Since that's scary, this function
	 * transforms the string so it can be parsed as JSON.
	 */
	static cs_repair_json(badJSON) {
		return badJSON
			.replace(/:\s*"([^"]*)"/g, function(match, p1) {
				return ': "' + p1.replace(/:/g, '@colon@') + '"';
			})
			.replace(/:\s*'([^']*)'/g, function(match, p1) {
				return ': "' + p1.replace(/:/g, '@colon@') + '"';
			})
			.replace(/(['"])?([a-z0-9A-Z_]+)(['"])?\s*:/g, '"$2": ')
			.replace(/@colon@/g, ':')
		;
	}

	cs_connect_if_needed() {
		// Return a resolved promise (which won't hold anything up) if we're already
		// connected, otherwise return a connect promise.
		return this.connected ? Promise.resolve() : this.cs_connect();
	}

	/// Log in to the system.
	/**
	 * This will always log in (even if already logged in), so
	 * cs_connect_if_needed() might be a better choice.
	 *
	 * @return Promise.  Later, this.connected is set to true if the connection
	 *   attempt succeeded, or false if it was not possible to log in.
	 */
	cs_connect() {
		console.log('cs_connect(): Logging in');
		var self = this;
		return new Promise(function(fulfill, reject) {
			Request
				.post({
					url: 'https://www2.commsec.com.au/Public/HomePage/Login.aspx',
					jar: self.cookiejar,
					followRedirect: false,
					form: {
						'ctl00$cpContent$txtLogin': self.creds.username,
						'ctl00$cpContent$txtPassword': self.creds.password,
						'ctl00$cpContent$btnLogin': '',
						'__EVENTTARGET': '',
					}
				})
			.on('response', function(response) {
				if (response.statusCode == 302) {
					console.log('cs_connect(): Logged in successfully');
					self.connected = true;
					fulfill();
				}
			})
			.on('error', function(err) {
				console.log(err);
				console.log(response);
				console.log('cs_connect(): Login failed');
				self.connected = false;
				reject(err);
			})
		;
		});
	}

	cs_get_market_data(stocks) {
		console.log('cs_get_market_data()');
		var self = this;
		var postdata = {
			stockCodes: '',
			properties: 'Equities',
		};
		var separator = '';
		for (var sym in stocks) {
			postdata.stockCodes += separator;
			postdata.stockCodes += sym;
			separator = ';';
		}
		var fnRequest = function(attemptComplete, attemptFailed) {
			if (!self.connected) {
				console.log('BUG: Attempted cs_get_market_data() when logged out');
				attemptFailed('Cannot request stock quote when logged out.');
				return;
			}
			Request
				.post({
					url: 'https://www2.commsec.com.au/Private/Watchlist/Watchlists.asmx/GetMarketData',
					jar: self.cookiejar,
					followRedirect: false,
					json: true,
					headers: {
						'Content-Type': 'application/json; charset=utf-8',
					},
					body: postdata,
				}, function(err, response, body) {
					if (err || response.statusCode != 200) {
						console.log('cs_get_market_data(): Server returned '
							+ response.statusCode + ': session seems to have expired');
						self.connected = false;
						attemptFailed(err);
						return;
					}
					var data = JSON.parse(CommsecBroker.cs_repair_json(body.d));
					var priceData = data[0].PriceData;
					for (var sym in priceData) {
						stocks[sym].price = priceData[sym].Last;
						stocks[sym].volume = priceData[sym].Volume.replace(/,/g, '');
						if (priceData[sym].SensitiveAnnouncement != 'False') {
							// TODO: Issue sensitive-announcement alert
						}
					}
					attemptComplete();
				})
			;
		};
		return retry(3, function(attemptComplete, attemptFailed) {
			if (!self.connected) {
				console.log('cs_get_market_data(): Reconnecting then retrying');
				self.cs_connect().then(function() {
					fnRequest(attemptComplete, attemptFailed);
				});
			} else {
				fnRequest(attemptComplete, attemptFailed);
			}
		});
	}

	/// Place an order in the system.
	/**
	 * There are three steps to this.  First the page must be loaded to obtain
	 * some ASP.NET state variables.  Without this step, an error will appear
	 * complaining that you must select the brokerage amount and the advice type.
	 * Supplying these variables as form controls is not enough - there appears
	 * to be some sort of validation to ensure these values are not coming from
	 * form controls if the user does not have sufficient access (otherwise it
	 * would be possible to choose $0 brokerage fees!)
	 *
	 * The second step is where the trading password is entered.  This also
	 * requires ASP.NET variables from step 1, which is how the the stock and
	 * amounts are taken across.
	 *
	 * The third step is to verify that no problems were encountered with the
	 * order.
	 *
	 * Note that warnings are currently treated as errors (e.g. the warning about
	 * placing an order when an order is already in the system.)
	 */
	cs_place_order(type, order) {
		var self = this;

		return new Promise(function(fulfillOrder, rejectOrder) {
			var fnRequest = function(attemptComplete, attemptFailed) {
				if (!self.connected) {
					console.log('BUG: Attempted cs_place_order() when logged out');
					attemptFailed('Cannot place an order when logged out.');
					return;
				}
				console.log('cs_place_order(): order step 1');
				Request
					.get({
						url: 'https://www2.commsec.com.au/Private/EquityTrading/AustralianShares/PlaceOrder.aspx',
						jar: self.cookiejar,
						followRedirect: false,
					}, function(err, response, body) {
						// Parse HTML and extract ASP.NET variables
						var cheerio = require('cheerio');
						let $ = cheerio.load(body);
						var viewstate = $('#__VIEWSTATE').val();
						self.cs_place_order_step2(type, order, viewstate, attemptFailed,
							fulfillOrder, rejectOrder);
					});
				return;
			};

			retry(3, function(attemptDone, attemptFailed) {
				return self.cs_connect_if_needed()
					.then(function() {
						fnRequest(attemptDone, attemptFailed);
					});
			}).then(function(s) {
				// Whole process succeeded
				fulfillOrder(s);
			}, function(err) {
				// All retries failed, abort the whole operation
				rejectOrder(err);
			});
		});
	}

	/// Second step of the order process.
	/**
	 * This supplies details about the trade - stock, amounts, etc.
	 *
	 * @return undefined.  The operation happens asynchronously.
	 */
	cs_place_order_step2(type, order, viewstate, attemptFailed, fulfillOrder, rejectOrder) {
		var self = this;
		var postdata = {
			// Empty if at-market is on
			'ctl00$BodyPlaceHolder$OrderView1$ctl02$txtOrderStyleLimitPrice$field': order.price,
			//'ctl00$BodyPlaceHolder$OrderView1$ctl02$cbOrderStyleAtMarket$field': 'on',

			'OrderType': 'ctl00$BodyPlaceHolder$OrderView1$ctl02$rboOrder' + type + '$field',
			'ctl00$BodyPlaceHolder$OrderView1$ctl02$ucSecuritySearch$txtSmartSearch$Input': order.stock,
			'ctl00$BodyPlaceHolder$OrderView1$ctl02$txtQuantityUnits$field': order.quantity,
			'ctl00$BodyPlaceHolder$OrderView1$ctl02$txtQuantityValue$field': '',

			// Empty if good-for-day is on
			//'ctl00$BodyPlaceHolder$OrderView1$ctl02$txtExpiryGoodUntil$field': '19/09/2016',
			'ctl00$BodyPlaceHolder$OrderView1$ctl02$cbExpiryGoodForDay$field': 'on',

			// buy only
			'Settlement': 'ctl00$BodyPlaceHolder$OrderView1$ctl02$rdoSponsored$field',

			//'Brokerage': 'ctl00$BodyPlaceHolder$OrderView1$ctl02$rboDefault$field',
			//'Brokerage': 'ctl00$BodyPlaceHolder$OrderView1$ctl02$rboTotalBrokerage$field',
			//'ctl00$BodyPlaceHolder$OrderView1$ctl02$txtTotalMoney$field': '19.95',
			//'ctl00$BodyPlaceHolder$OrderView1$ctl02$txtTotalPercent$field': '0',

			//'ctl00$BodyPlaceHolder$OrderView1$ctl02$txtAdviserNotes$field': '',
			//'ctl00$BodyPlaceHolder$OrderView1$ctl02$txtConfirmationComment$field': '',

			'ctl00$BodyPlaceHolder$OrderView1$ctl02$txtSRN$field': '',
			'ctl00$BodyPlaceHolder$OrderView1$ctl02$btnPreview$implementation$field': 'Proceed',
			'ctl00$BodyPlaceHolder$OrderView1$ctl02$hidIsMLAccount': 'False',

			'ctl00$ucSecuritySearch$txtOptionParent$field': '',
			'ctl00$ucSecuritySearch$ddlExpiryMonth$field': 0,
			'ctl00$ucSecuritySearch$ddlExpiryYear$field': 2016,
			'ctl00$ucSecuritySearch$ddlOptionStrat$field': 'Both',
			'ctl00$ucSecuritySearch$ddlOptionExercise$field': 'A',

			//'ctl00$BodyPlaceHolder$OrderView1$ctl02$rbOther$field': 'false',
			//'ctl00$BodyPlaceHolder$OrderView1$ctl02$cboTypeAdvice$field': 'test',

			//'ctl00$BodyPlaceHolder$OrderView1$ctl02$rdoIssuer$field': '',
			//'ctl00$BodyPlaceHolder$OrderView1$ctl02$rdoSponsored$field': '',

			//'ctl00$BodyPlaceHolder$OrderView1$ctl02$ucOrderSpecification$tradingPwd$tradingPwdCGTextBox$field': self.creds.tradpass,

			'__EVENTTARGET': '',
			'__VIEWSTATE': viewstate,
		};
		console.log('cs_place_order_step2(): order step 2');
		Request
			.post({
				url: 'https://www2.commsec.com.au/Private/EquityTrading/AustralianShares/PlaceOrder.aspx',
				jar: self.cookiejar,
				followRedirect: false,
				form: postdata,
			}, function(err, response, body) {
				if (err || response.statusCode != 200) {
					console.log('cs_place_order_step2(): Server returned '
											+ response.statusCode + ': session seems to have expired');
					self.connected = false;
					attemptFailed(err); // will trigger retry
					return;
				}

				var cheerio = require('cheerio');
				let $ = cheerio.load(body);
				//console.log(body);

				var tradingpw_box = $('#ctl00_BodyPlaceHolder_OrderView1_ctl02_ucOrderSpecification_tradingPwd_tradingPwdCGTextBox_field');
				if (tradingpw_box.length == 0) {
					// Didn't get a page with the trading password text box on it, so
					// something must have gone wrong.
					var errors = $('#ctl00_BodyPlaceHolder_OrderView1_ctl02_mpMessage ul li.error');
					var errorString = 'Trade error: ';
					if (errors.length > 0) {
						for (var i = 0; i < errors.length; ++i) {
							if (i > 0) errorString += ', ';
							errorString += $('a', errors[i]).text();
						}
					} else {
						errorString += 'Got an unexpected response to step 2';
					}
					console.log('cs_place_order_step2() returning error: ' + errorString);
					// Fail the trade
					rejectOrder(errorString);
					return;
				}

				var viewstate2 = $('#__VIEWSTATE').val();
				var p1 = $('input[name="ctl00$BodyPlaceHolder$OrderView1$ctl00"]').val();
				var p2 = $('input[name="ctl00$BodyPlaceHolder$OrderView1$ctl01"]').val();
				self.cs_place_order_step3(type, order, viewstate2, p1, p2,
					attemptFailed, fulfillOrder, rejectOrder);
			})
		;
	}

	/// Third step of the order process.
	/**
	 * This submits the trading password and receives confirmation of the order.
	 *
	 * @return undefined.  The operation happens asynchronously.
	 */
	cs_place_order_step3(type, order, viewstate, p1, p2, attemptFailed, fulfillOrder, rejectOrder) {
		var self = this;
		var postdata = {
			'ctl00$BodyPlaceHolder$OrderView1$ctl02$ucOrderSpecification$tradingPwd$tradingPwdCGTextBox$field': self.creds.tradpass,

			'__EVENTTARGET': 'ctl00$BodyPlaceHolder$OrderView1$ctl02$ucOrderSpecification$btnSubmitOrder$implementation$field',
			'__VIEWSTATE': viewstate,
			'ctl00$BodyPlaceHolder$OrderView1$ctl00': p1,
			'ctl00$BodyPlaceHolder$OrderView1$ctl01': p2,
		};
		console.log('cs_place_order_step3(): order step 3');
		Request
			.post({
				url: 'https://www2.commsec.com.au/Private/EquityTrading/AustralianShares/PlaceOrder.aspx',
				jar: self.cookiejar,
				followRedirect: false,
				form: postdata,
			}, function(err, response, body) {
				if (err || response.statusCode != 200) {
					console.log('cs_place_order_step3(): Server returned '
						+ response.statusCode + ': session seems to have expired');
					self.connected = false;
					attemptFailed(err); // will trigger retry
					return;
				}

				var cheerio = require('cheerio');
				let $ = cheerio.load(body);

				var step2_button = $('#ctl00_BodyPlaceHolder_OrderView1_ctl02_btnPreview_implementation_field');
				var errors = $('ul.AbbreviatedInfoPanel li');
				if (step2_button.length > 0 || errors.length > 0) {
					// Something failed as we've gotten the step 2 page back again.
					var errorString = 'Trade error: ';
					if (errors.length > 0) {
						for (var i = 0; i < errors.length; ++i) {
							if (i > 0) errorString += ', ';
							errorString += $('h4', errors[i]).text().trim();
						}
					} else {
						errorString += 'Got an unexpected response to step 3';
					}
					console.log('cs_place_order_step3() returning error: ' + errorString);
					// Fail the trade
					rejectOrder(errorString);
					return;
				}
				var ctAmount = $('#ctl00_BodyPlaceHolder_OrderView1_ctl02_gvConfirmation_Underlying_ctl03_lblQty_field');
				var confirmedAmount = 0;
				if (ctAmount.length == 1) {
					confirmedAmount = parseInt(ctAmount.text().replace(/,/g, ''));
				}
				if (confirmedAmount == order.quantity) {
					fulfillOrder(order); // finished at last
					return;
				} else {
					console.log('cs_place_order_step3(): Confirmed amount '
						+ confirmedAmount + ' does not match order of ' + order.quantity
						+ ', returning error');
					rejectOrder('Trade error: Tried to order ' + order.quantity
						+ ', got ' + confirmedAmount);
					return;
				}
			})
		;
	}
}

module.exports = CommsecBroker;
