'use strict';

class Broker
{
	set_credentials(creds) {
		this.creds = creds;
	}

	fill_prices(stocks) {
		console.log("BUG: Broker does not provide stock quotes.");
	}

	/// Place a buy order.
	/**
	 * Submit a buy order to the trading platform.
	 *
	 * @param object order
	 *   Object containing these members:
	 *     - stock, string: stock ticker code
	 *     - quantity, int: number of units to buy
	 *     - price, float: maximum price per unit to pay.  If null, an at-market
	 *       order is placed.
	 *
	 * @return Promise.
	 */
	buy(order) {
		console.log("BUG: Broker does not provide buy orders.")
	}

	/// Place a sell order.
	/**
	 * Submit a sell order to the trading platform.
	 *
	 * @param object order
	 *   Object containing these members:
	 *     - stock, string: stock ticker code
	 *     - quantity, int: number of units to sell
	 *     - price, float: minimum sale price per unit.  If null, an at-market
	 *       order is placed.
	 *
	 * @return Promise.
	 */
	sell(order) {
		console.log("BUG: Broker does not provide sell orders.")
	}
}

module.exports = Broker;
