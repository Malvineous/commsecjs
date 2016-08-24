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

/// Round a number to the given number of decimal places
/**
 * Unlike other solutions, 5 is rounded up: 1.005 -> 1.01
 */
function mathRound(value, decimals) {
	return Number(Math.round(value+'e'+decimals)+'e-'+decimals);
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

	/// Convert a string 'd/mm/yyyy' into a Date object.
	static cs_parse_date(date_dmy) {
		return new Date(
			date_dmy.replace(
				/([0-9]+)\/([0-9]+)\/([0-9]+)/,
				'$3-$2-$1 UTC+1000'
			)
		);
	}
	/// Convert a Date object into a 'd/m/yyyy' string.
	static cs_format_date(d) {
		return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear();
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
			if (!self.creds) {
				reject('Missing CommSec credentials!');
				return;
			}
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

	/// Get the price of one or more stocks.
	/**
	 * @see fill_prices()
	 */
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
		var fnRequest = function(retryOff, retryNow) {
			if (!self.connected) {
				console.log('BUG: Attempted cs_get_market_data() when logged out');
				retryNow('Cannot request stock quote when logged out.');
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
						retryNow(err);
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
					retryOff();
				})
			;
		};
		return retry(3, function(retryOff, retryNow) {
			if (!self.connected) {
				console.log('cs_get_market_data(): Reconnecting then retrying');
				self.cs_connect().then(function() {
					fnRequest(retryOff, retryNow);
				});
			} else {
				fnRequest(retryOff, retryNow);
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
	 *
	 * @note If there is any problem during any step, the operation will be
	 *   started over from the beginning, up to three times before returning
	 *   failure.  This is to handle a session timeout.  In this case the
	 *   function will automatically attempt to log in again, then try to place
	 *   the order from step 1, up to three times before giving up.
	 *
	 * @param string type
	 *   Order type.  "Buy" or "Sell", case sensitive.
	 *
	 * @param object order
	 *   See Broker.buy() or Broker.sell().
	 *
	 * @return Promise.
	 */
	cs_place_order(type, order) {
		var self = this;

		return new Promise(function(fulfillOperation, rejectOperation) {
			var fnRequest = function(retryOff, retryNow) {
				console.log('cs_place_order(): order step 1');
				if (!self.connected) {
					console.log('BUG: Attempted cs_place_order() when logged out');
					order.error = 'Cannot place an order when logged out.';
					retryOff();
					rejectOperation(order);
					return;
				}
				Request
					.get({
						url: 'https://www2.commsec.com.au/Private/EquityTrading/AustralianShares/PlaceOrder.aspx',
						jar: self.cookiejar,
						followRedirect: false,
					}, function(err, response, body) {
						if (err || response.statusCode != 200) {
							console.log('cs_place_order(): Server returned '
								+ response.statusCode + ': session seems to have expired');
							self.connected = false;
							retryNow(err);
							return;
						}
						// Parse HTML and extract ASP.NET variables
						var cheerio = require('cheerio');
						let $ = cheerio.load(body);
						var viewstate = $('#__VIEWSTATE').val();
						self.cs_place_order_step2(type, order, viewstate, retryOff,
							retryNow, fulfillOperation, rejectOperation);
					});
				return;
			};

			retry(3, function(retryOff, retryNow) {
				return self.cs_connect_if_needed()
					.then(function() {
						fnRequest(retryOff, retryNow);
					});
			}).then(null, function(err) {
				// All retries failed, abort the whole operation
				rejectOperation(err);
			});
		});
	}

	/// Second step of the order process.
	/**
	 * This supplies details about the trade - stock, amounts, etc.
	 *
	 * @param function retryOff
	 *   This function is called when the operation has completed in a way that
	 *   does not require it to be retried.  This will be called on success, or
	 *   on a failure that will still be present if the operation is tried again.
	 *
	 * @param function retryNow
	 *   This function is called when the operation has failed in a way that
	 *   suggests a transient error, such as the session having expired.  Once
	 *   this function is called, the operation will be started over from the
	 *   beginning.
	 *
	 * @param function fulfillOperation
	 *   This function is called when the operation has completed successfully.
	 *   Note that on success, both retryOff() and fulfillOperation() will be
	 *   called.  The parameter to this function will be returned to the library
	 *   user in their then() success handler.
	 *
	 * @param function rejectOperation
	 *   This function is called when the operation has failed due to a permanent
	 *   error, e.g. insufficient funds.  The parameter to this function will be
	 *   returned to the library user in their then() failure handler.
	 *
	 * @return undefined.  The operation happens asynchronously.
	 */
	cs_place_order_step2(type, order, viewstate, retryOff, retryNow,
		fulfillOperation, rejectOperation
	) {
		var self = this;

		// CommSec only accepts orders in whole cents
		order.price = mathRound(order.price, 2);

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

		if (order.price == null) {
			// null price means 'at market'
			postdata['ctl00$BodyPlaceHolder$OrderView1$ctl02$cbOrderStyleAtMarket$field']
				= 'on';
		}

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
					retryNow(err); // will trigger retry
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
					order.error = errorString;
					rejectOperation(order);
					return;
				}

				var nextPostdata = {
					'ctl00$BodyPlaceHolder$OrderView1$ctl00': $('input[name="ctl00$BodyPlaceHolder$OrderView1$ctl00"]').val(),
					'ctl00$BodyPlaceHolder$OrderView1$ctl01': $('input[name="ctl00$BodyPlaceHolder$OrderView1$ctl01"]').val(),
					'ctl00$BodyPlaceHolder$OrderView1$ctl02$ucOrderSpecification$tradingPwd$tradingPwdCGTextBox$field': self.creds.tradpass,
					'__VIEWSTATE': $('#__VIEWSTATE').val(),
					'__EVENTTARGET': 'ctl00$BodyPlaceHolder$OrderView1$ctl02$ucOrderSpecification$btnSubmitOrder$implementation$field',
				};
				self.cs_place_order_step3(type, order, nextPostdata,
					retryNow, retryOff, fulfillOperation, rejectOperation);
			})
		;
	}

	/// Third step of the order process.
	/**
	 * This submits the trading password and receives confirmation of the order.
	 *
	 * @return undefined.  The operation happens asynchronously.
	 */
	cs_place_order_step3(type, order, postdata, retryNow, retryOff,
		fulfillOperation, rejectOperation
	) {
		var self = this;
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
					retryNow(err); // will trigger retry
					return;
				}

				// If we've gotten this far then doing the whole operation again won't
				// make any difference, so don't bother retrying any more.
				retryOff();

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
					order.error = errorString;
					rejectOperation(order);
					return;
				}
				var ctRef = $('#ctl00_BodyPlaceHolder_OrderView1_ctl02_lblReferenceNo');
				if (ctRef.length != 1) {
					console.log('cs_place_order_step3(): Did not get a reference number for this order');
					order.error = 'Trade error: Did not get a reference number for this order';
					rejectOperation(order);
					return;
				}
				var ref = ctRef.text().trim();
				if (ref.length > 0) {
					console.log('cs_place_order_step3(): Order reference is ' + ref);
					order.id = ref;
					fulfillOperation(order); // finished at last
					return;
				}
				console.log('cs_place_order_step3(): Got an empty order reference number, failing');
				order.error = 'Got an empty order reference number.';
				rejectOperation(order);
				return;
			})
		;
	}

	/// Get a list of the 10 most recent completed orders.
	/**
	 * @return Promise.  On success the parameter is an array of confirmation
	 *   items.  See cs_scrape_confirmations().
	 */
	cs_get_confirmations() {
		var self = this;

		return new Promise(function(fulfillOperation, rejectOperation) {
			var fnRequest = function(retryOff, retryNow) {
				if (!self.connected) {
					console.log('BUG: Attempted cs_get_confirmations() when logged out');
					retryOff();
					rejectOperation('Cannot retrieve order confirmations when logged out.');
					return;
				}
				Request
					.get({
						url: 'https://www2.commsec.com.au/Private/MyPortfolio/Confirmations/Confirmations.aspx',
						jar: self.cookiejar,
						followRedirect: false,
					}, function(err, response, body) {
						//console.log(body);

						// If we've gotten this far then doing the whole operation again won't
						// make any difference, so don't bother retrying any more.
						retryOff();

						var confirmations = self.cs_scrape_confirmations(body);
						if (typeof confirmations == 'string') {
							rejectOperation(confirmations);
							return;
						}
						fulfillOperation(confirmations);
					});
				return;
			};

			retry(3, function(retryOff, retryNow) {
				return self.cs_connect_if_needed()
					.then(function() {
						fnRequest(retryOff, retryNow);
					});
			}).then(function(s) {
				// Whole process succeeded
				fulfillOperation(s);
			}, function(err) {
				// All retries failed, abort the whole operation
				rejectOperation(err);
			});
		});
	}

	/// Scrape the HTML on the order confirmations page and return an array.
	/**
	 * @param string body
	 *   HTML content from CommSec confirmations page.
	 *
	 * @return Array of objects, each object being:
	 *   - idConf, string: confirmation ID.
	 *   - idOrder, string: order ID, matching return value from buy() or sell().
	 *   - trade_date, Date: Date the trade took place (midnight UTC+10).
	 *   - is_buy, bool: true for a buy, false for a sell.
	 *   - stock, string: stock ticker code.
	 *   - units, int: Number of units bought or sold.
	 *   - price_approx, float: Average sold price (only to three decimal places).
	 *   - fee, float: Fee charged, e.g. 19.95.
	 *   - total, float: Total amount of transaction, including fee.
	 *   - settlement_date, Date: Date the funds will settle.
	 */
	cs_scrape_confirmations(body) {
		var cheerio = require('cheerio');
		let $ = cheerio.load(body);

		var table = $('#ctl00_BodyPlaceHolder_ConfirmationsView1_gdvwConfirmationDetails_Underlying');
		if (!table) return 'cs_scrape_confirmations(): Cannot find confirmations table!';

		var data = [];
		var fnConf = function(index, element) {
			var c = $(this).attr('class');
			return c === 'GridRow' || c === 'GridAlternateRow';
		};
		table.children('tr').filter(fnConf).each(function(rowIndex, rowElement) {
			var rows = $(rowElement).children('td');
			data.push({
				idConf: $(rows[0]).text().trim(),
				idOrder: $(rows[1]).text().trim(),
				trade_date: CommsecBroker.cs_parse_date($(rows[2]).text().trim()),
				is_buy: $(rows[3]).text().trim() === 'B',
				stock: $('span.StockCode', rows[4]).text().trim(),
				units: parseInt($(rows[5]).text().trim().replace(/,/g, '')),
				price_approx: parseFloat($(rows[6]).text().trim()),
				fee: parseFloat($(rows[7]).text().trim().replace(/,/g, '')),
				total: parseFloat($(rows[8]).text().trim().replace(/,/g, '')),
				settlement_date: CommsecBroker.cs_parse_date($(rows[9]).text().trim()),
			});
		});
		return data;
	}

	/// Get a list of completed orders.
	/**
	 * @return Promise.  On success the parameter is an array of confirmation
	 *   items.  See cs_scrape_confirmations().
	 */
	cs_get_confirmations_range(date_from, date_to) {
		var self = this;

		return new Promise(function(fulfillOperation, rejectOperation) {
			var fnRequest = function(retryOff, retryNow) {
				if (!self.connected) {
					console.log('BUG: Attempted cs_get_confirmations() when logged out');
					retryOff();
					rejectOperation('Cannot retrieve order confirmations when logged out.');
					return;
				}
				Request
					.get({
						url: 'https://www2.commsec.com.au/Private/MyPortfolio/Confirmations/Confirmations.aspx',
						jar: self.cookiejar,
						followRedirect: false,
					}, function(err, response, body) {
						//console.log(body);

						var cheerio = require('cheerio');
						let $ = cheerio.load(body);
						var viewstate = $('#__VIEWSTATE').val();
						Request
							.post({
								url: 'https://www2.commsec.com.au/Private/MyPortfolio/Confirmations/Confirmations.aspx',
								jar: self.cookiejar,
								followRedirect: false,
								form: {
									'ctl00$BodyPlaceHolder$ConfirmationsView1$chbxBuy$field': 'on',
									'ctl00$BodyPlaceHolder$ConfirmationsView1$chbxSell$field': 'on',
									'ctl00$BodyPlaceHolder$ConfirmationsView1$calendarFrom$field': CommsecBroker.cs_format_date(date_from),
									'ctl00$BodyPlaceHolder$ConfirmationsView1$calendarTo$field': CommsecBroker.cs_format_date(date_to),

									'__VIEWSTATE': viewstate,
									'__EVENTTARGET': 'ctl00$BodyPlaceHolder$ConfirmationsView1$gdvwConfirmationDetails_Underlying$TopPagerRow$btnAll$implementation',
								},
							}, function(err, response, body) {
								// If we've gotten this far then doing the whole operation again won't
								// make any difference, so don't bother retrying any more.
								retryOff();

								var confirmations = self.cs_scrape_confirmations(body);
								if (typeof confirmations == 'string') {
									rejectOperation(confirmations);
									return;
								}
								fulfillOperation(confirmations);
							});
						return;
					});
				return;
			};

			retry(3, function(retryOff, retryNow) {
				return self.cs_connect_if_needed()
					.then(function() {
						fnRequest(retryOff, retryNow);
					});
			}).then(function(s) {
				// Whole process succeeded
				fulfillOperation(s);
			}, function(err) {
				// All retries failed, abort the whole operation
				rejectOperation(err);
			});
		});
	}

}

module.exports = CommsecBroker;
