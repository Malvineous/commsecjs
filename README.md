CommSec trading interface for node.js
=====================================
**Copyright 2016-2017 Adam Nielsen <<malvineous@shikadi.net>>**

This is a node.js interface to the CommSec website.  Since CommSec offer no
public API, this script works by accessing the normal website.  It uses some
JSON interfaces, but mostly works by POSTing forms as if they were submitted
by a human.

All this is abstracted away into an asynchronous interface.

Installation
------------

    npm install commsec

Example
-------

See `test.js` for a more detailed example.


```javascript
var Broker = require('commsec');

var brokers = Broker.get_brokers();
var b = new brokers[0](); // CommSec is the only one at present

// Set the credentials to use.  The trading password is only needed to perform
// trades and can be omitted if no orders will be placed.
b.set_credentials({
	username: 'myuser',
	password: 'mypass',
	tradpass: 'mytrading'
});

// This is the structure of stocks when querying prices.
var stocks = {
	'ANZ': {
		price: 0,
		volume: 0,
	},
	'BHP': {
		price: 0,
		volume: 0,
	}
};

// Populate the price and volume members in the above structure.
b.fill_prices(stocks).then(function() {
	// This function will be run if the prices are retrieved successfully.

	// Display the updated structure with the latest prices.
	console.log(stocks);

	// Perform a trade.
	var newprice = stocks['BHP'].price * 0.95;
	console.log('Buying BHP at 95% of current market value (' + newprice + ')');
	b.buy({
		stock: 'BHP',    // Stock to trade
		quantity: 510,   // How many units to trade
		price: newprice, // Limit price, or null to trade at-market
		id: null,        // On return, the order ID
	}).then(function(order) {
		// This function is called on success.
		console.log('Order successful: ' + order.id + ' at ' + order.price);

	}, function(order) {
		// This function is called on failure (e.g. order too small.)
		console.log('Order failed: ' + order.error);
	});
});

// Because of the asynchronous nature of the requests, the code here will
// run before the above price query/trade has even started.  So don't put any
// more broker functions here, otherwise they will both try to race each other
// and log in at the same time.  The Promise's then() function must be used to
// order operations.
```
