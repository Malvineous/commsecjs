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
	 *     - quantity, int: number of units to buy (or sell)
	 *     - price, float: maximum price per unit to buy (or minimum price to
	 *       sell for.)  If null, an at-market order is placed.
	 *     - id, string: Once the Promise is fulfilled, this is the order ID.
	 *     - error, string: If the Promise is rejected, this contains the reason
	 *       why.
	 *
	 * @return Promise.  The parameter to the fulfill and reject functions is
	 *   the original 'order' parameter, with the 'id' member included on
	 *   success, or the 'error' member included on failure.
	 */
	buy(order) {
		console.log("BUG: Broker does not provide buy orders.")
	}

	/// Place a sell order.
	/**
	 * Submit a sell order to the trading platform.
	 *
	 * @see buy().
	 */
	sell(order) {
		console.log("BUG: Broker does not provide sell orders.")
	}
}

module.exports = Broker;
