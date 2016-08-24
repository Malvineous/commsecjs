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

	/// Check the status of an order.
	/**
	 * Find out whether an order has been processed yet.
	 *
	 * @return Promise.  The fulfill function is passed an object with these
	 *   members:
	 *     - trade_id, string: ID number for the trade
	 *     - order_id, string: ID number from the original order as returned from
	 *       the original buy() or sell().
	 *     - trade_date, Date: Date the trade took place (midnight UTC+10).
	 *     - is_buy, bool: true for a buy, false for a sell.
	 *     - stock, string: stock ticker code.
	 *     - units, int: Number of units bought or sold.
	 *     - price_approx, float: Average sold price (only to one decimal place), cents.
	 *     - fee_cents, int: Fee charged, e.g. 1995 for $19.95.
	 *     - total_cents, int: Total amount of transaction, including fee.
	 *     - settlement_date, Date: Date the funds will settle.
	 */
	status(order_id) {
		console.log("BUG: Broker does not provide order status.")
	}

	/// Retrieve historical orders.
	/**
	 * Retrieve a list of processed orders between the two given dates.
	 *
	 * @return Promise.  The fulfill function is given one parameter, which is an
	 *   array of objects, with each object matching the one obtained from
	 *   status().
	 */
	history(date_from, date_to) {
		console.log("BUG: Broker does not provide order history.")
	}

	/// Calculate how much fee the broker will charge for a proposed transaction.
	/**
	 * @param int unit_price_cents
	 *   Proposed price of the stock, in cents (1995 = $19.95).
	 *
	 * @param int count
	 *   Number of units to trade.
	 *
	 * @param bool is_buy
	 *   True if this is a buy, false if a sell.
	 */
	calculate_fee(unit_price_cents, count, is_buy) {
		console.log("BUG: Broker cannot calculate transaction fee.")
	}
}

module.exports = Broker;
