// CommSec mobile API NodeJS interface.
// Copyright 2016-2018 Adam Nielsen <malvineous@shikadi.net>

const nodeFetch = require('node-fetch')
const fetch = require('fetch-cookie')(nodeFetch);

/// API endpoint.
const urlBase = 'https://app.commsec.com.au/v5/services/service.svc/';

// Trading calls will fail unless there is a HTTP 'Origin' header.
const urlOrigin = 'https://app.commsec.com.au';

// Borrowed from https://stackoverflow.com/a/32749533/308237
/// Base class for custom exceptions.
class ExtendableError extends Error {
	constructor(message) {
		super(message);
		this.name = this.constructor.name;
		if (typeof Error.captureStackTrace === 'function') {
			Error.captureStackTrace(this, this.constructor);
		} else {
			this.stack = (new Error(message)).stack;
		}
	}
}

/// Thrown when the login process fails for an unknown reason.
class LoginError extends ExtendableError {
};

/// Thrown when the login process fails because of bad credentials.
class AccessDeniedError extends ExtendableError {
};

class CommSec
{
	constructor(opts)
	{
		this.debug = (opts && opts.debug) || false;
		this.debugResponses = (opts && opts.dumpServerResponses) || false;
	}

	/// Log in to the server.
	/**
	 * @param object creds
	 *   Credentials.  Object with the following properties:
	 *     - clientId: username
	 *     - deviceId: null to allocate one (maybe) in the response, or
	 *       the device ID if known.  Mandatory for PIN login.
	 *     - loginType: "pin" or "password".
	 *     - password: Actual PIN or password as a string.
	 *     - tradingPassword: Optional password only required to call
	 *       functions that perform trades.
	 *
	 * The app works as follows:
	 *
	 *   1. Log in with clientId, deviceId=null, loginType=password.
	 *   2. Remembers deviceId returned from login call.
	 *   3. Future logins are with clientId, saved deviceId and loginType=pin or
	 *      password depending on user prefs.
	 *
	 * During testing I was not able to get the API to give me a new deviceId, it
	 * always returned an empty string.  The deviceId is only needed for PIN login
	 * to work.  Probably a good idea to save and use it anyway (if you get a
	 * non-null one) to avoid the server allocating too many device IDs for you
	 * and bumping off old ones that you're still actually using.
	 *
	 * @return Object from server.  Some properties are interesting:
	 *   - deviceId: Normally null, but supplied here if a new device ID has been
	 *     allocated for you.  Pass this during future logins to get PIN login
	 *     working.
	 *   - accounts: Array of accounts in the event you have more than one trading
	 *     account under the same login.  accounts[x].mobileOperations is an array
	 *     of strings like 'placeOrder', 'amendOrder', 'cancelOrder' depending on
	 *     what parts of the API the logged in user has access to.
	 *   - tradingPasswordEnabled: true if password needed for trades.
	 */
	async login(creds)
	{
		const debug = this.getDebug('login');
		debug('Attemping to log in');

		// Save the creds for later in case we get logged out.
		if (creds) {
			this.creds = {
				"devicePlatform": "nodejs", // "android" in app
				...creds,
			};
			this.tradingPassword = this.creds.tradingPassword;
			// We don't need to pass this to the login call.
			delete this.creds.tradingPassword;
		}

		try {
			let f = await this.post(
				'login',
				this.creds,
				0 // no retries
			);
			debug('Login successful');
			let jsonLogin = await f;
			if (jsonLogin.accounts) {
				const defaultTradingAccount = jsonLogin.accounts.find(
					i => i.defaultTradingAccount
				);
				if (defaultTradingAccount) {
					this.defaultAccount = defaultTradingAccount.accountNumber;
					debug('Found default trading account:', this.defaultAccount);
				} else {
					debug('No default trading account found, you will have to specify one.');
				}
			}
			if (jsonLogin.deviceId) {
				debug('New device ID allocated:', jsonLogin.deviceId);
			}
			return jsonLogin;
		} catch (e) {
			if (e instanceof AccessDeniedError) {
				throw new LoginError('Login not permitted: ' + e.message);
			}
			throw new LoginError('Unknown login error: ' + e.message);
		}
	}

	/// Log out from the server.
	async logout()
	{
		const debug = this.getDebug('logout');
		debug('Attemping to log out');
		return this.post(
			'logout', null, 0 // no retries
		);
	}

	/// Retrieve a list of the current holdings.
	/**
	 * @param int ac
	 *   [Optional] Account number to query.  Omit for the default
	 *   account.
	 *
	 * @return Promise resolving to an array of holdings.
	 */
	async getHoldings(ac)
	{
		return this.get('getholdings', {
			accountId: ac || this.defaultAccount,
		});
	}

	/// Retrieve all the watchlists and prices.
	/**
	 * @return Promise resolving to an array of watchlists.
	 */
	async getWatchlists()
	{
		return this.get('watchlists');
	}

	/// Retrieve a list of orders on the selected account.
	/**
	 * @param Date from
	 *   [Optional] Retrieve orders on or after this time.  The CommSec app uses
	 *   one month before the current time, as do we if this parameter is omitted.
	 *
	 * @param int limit
	 *   [Optional] Maximum number of orders to return.  If omitted we default to
	 *   20, the same as the CommSec app.
	 *
	 * @param int account
	 *   [Optional] Account number to use, omit to use the first one.
	 */
	async getOrders(from, limit, account)
	{
		if (!from) {
			from = new Date();
			from.setMonth(from.getMonth() - 1);
		}
		const unixFrom = Math.round(from.getTime() / 1000, 0);
		return this.get('getorders', {
			accountNumber: account || this.defaultAccount,
			fromDateTimeStamp: unixFrom,
			maxLength: limit || 20,
		});
	}

	/// Cancel an order already in the market.
	/**
	 * @note Cancelling an order that has already been cancelled will
	 *   still succeed.
	 *
	 * @param int orderId
	 *   Order ID (not order number) returned by getOrders().
	 *
	 * @return Object with properties:
	 *   - orderDidCancel: true if cancelled
	 *   - status: standard property 'success' or 'fail'
	 */
	async cancelOrder(orderId)
	{
		return this.post(
			'cancelorder',
			{
				'accountId': this.defaultAccount,
				'orderId': orderId,
				'requestToken': this.nextRequestToken,
				'tradingPassword': this.tradingPassword || '',
			}
		);
	}

	/// Retrieve prices for an arbitrary list of stocks.
	/**
	 * @param Object stockList
	 *   List of stocks of the form {"ABC": "hash", "DEF": "hash"}. The response
	 *   will include an updated hash for each stock, which should be supplied in
	 *   subsequent calls, to ensure that future responses only include data when
	 *   it changes.  Set all the hashes to null on the initial request.
	 *
	 * @param Promise resolving to an Object with data about any stocks which have
	 *   changed based on the hash passed in, along with updated hashes to pass in
	 *   on subsequent calls.  Stocks which have not changed since the last call
	 *   are omitted from the return value.
	 */
	async pollStocks(stockList)
	{
		return this.post(
			'getStockInfos',
			{
				"enableHash": true,
				"stockCodesWithHash": stockList,
			}
		);
	}

	/// Switch to a different account.
	/**
	 * @param int ac
	 *   Account number to switch to, e.g. 12345.
	 *
	 * The available accounts are returned in the login() call.  The 'default
	 * trading account' is selected initially, so this function only needs to be
	 * used if you have multiple trading accounts under the same CommSec login.
	 */
	setDefaultAccount(ac)
	{
		this.defaultAccount = ac;
	}

	/// Internal function to simplify display of debug messages.
	/*private*/ getDebug(title)
	{
		if (!this.debug) return () => {};
		return (...args) => {
			return console.log(`[commsec:${title}]`, ...args);
		}
	}

	/// Internal function to construct POST API calls.
	/*private*/ async post(service, params, retries = 1)
	{
		return this.call(service, {
			method: 'POST',
			body: JSON.stringify({
				data: JSON.stringify(params),
			}),
		}, retries);
	}

	/// Internal function to construct GET API calls.
	/*private*/ async get(service, params, retries = 1)
	{
		let query = Object.keys(params)
			.map(k => (
				encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
			)
			.join('&');
		return this.call(service + '?' + query, null, retries);
	}

	/// Internal function to issue the API call itself.
	/**
	 * @param string service
	 *   API function to call.  Appended onto the API endpoint string.
	 *
	 * @param object params
	 *   Additional parameters to fetch().
	 *
	 * @param int retries
	 *   Number of times to retry the call on error.  Typically this will be 1,
	 *   which allows for a broken connection to be re-established (logging in
	 *   again) and then a single retry is performed.  The login() call however
	 *   sets this to zero, so that a failed login won't be retried.  This
	 *   prevents an account from being locked because of something silly like the
	 *   wrong password passed to us.
	 *
	 * @return Promise resolving to an Object, containing the API's JSON response
	 *   already parsed.
	 */
	/*private*/ async call(service, params, retries)
	{
		const debug = this.getDebug('call:' + service);

		const fetchUrl = urlBase + service;
		const fetchOpts = {
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json',
				'Origin': urlOrigin, // Required for trades
			},
			...params,
		};
		debug('Calling API', fetchUrl);
		if (this.debugResponses) {
			debug('Request body:', fetchOpts.body);
		}
		let f = await fetch(fetchUrl, fetchOpts);

		let jsonResponse, txtResponse;
		const contentType = f.headers.get("content-type");
		if (contentType && contentType.indexOf("application/json") !== -1) {
			jsonResponse = await f.json();
		} else {
			txtResponse = await f.text();
		}

		if (this.debugResponses) {
			let msg;
			if (jsonResponse) {
				msg = JSON.stringify(jsonResponse);
			} else {
				msg = txtResponse;
			}
			debug(`Response HTTP ${f.status}:`, msg);
		}

		if (f.status === 200) {
			if (jsonResponse && jsonResponse.requestToken) {
				// Save the request token for the next time we need it.
				this.nextRequestToken = jsonResponse.requestToken;
				debug('Saving request token:', this.nextRequestToken);
			}
			return jsonResponse;
		}

		// If we get this far, there was an error.

		if ((f.status === 403) && (retries > 0)) {
			// Probably got logged out, try again after logging in
			await this.login();
			return this.call(service, params, retries - 1);
		}

		// No more retries left, do something about the failure.
		let msg;
		if (jsonResponse) {
			if (jsonResponse.message) {
				msg = jsonResponse.message;
			} else {
				console.error('BUG: Need to handle this JSON response type!', jsonResponse);
				msg = JSON.stringify(jsonResponse);
			}
		} else {
			// Not a JSON response
			msg = txtResponse;
		}
		msg = 'CommSec says: "' + msg + '"';
		if (f.status === 403) {
			throw new AccessDeniedError(msg);
		} else {
			throw new Error(msg);
		}
	}
};

module.exports = CommSec;
