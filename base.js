'use strict';

class Broker
{
	set_credentials(creds) {
		this.creds = creds;
	}

	fill_prices(stocks) {
		console.log("BUG: Broker does not provide stock quotes.");
	}

	buy(order) {
		console.log("BUG: Broker does not provide buy orders.")
	}

	sell(order) {
		console.log("BUG: Broker does not provide sell orders.")
	}
}

module.exports = Broker;
