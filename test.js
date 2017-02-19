'use strict';

var Broker = require('./index.js');

var brokers = Broker.get_brokers();
var broker = brokers[0];
var b = new broker();

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

b.set_credentials({
	username: 'user',
	password: 'pass',
	tradpass: 'pass2'
});

// First we fill the 'stocks' array with the current prices.  This updates the
// 'price' and 'volume' members (set to 0 above) with their current market
// values.  It completes immediately, returning a Promise, so we use then() to
// have the next bit of code run at some later time when the values have been
// retrieved from the website.
b.fill_prices(stocks).then(function(s) {
	// We will end up here in this callback function at some later time, once we
	// have logged into the site, sent off our stock list, and the server has
	// responded with the prices.

	// fill_prices() returns the stock array (here stored in the function
	// parameter 's') but because it also fills out the original array ('stocks')
	// we don't really need 's'.
	console.log(stocks);

	var newprice = stocks['BHP'].price * 0.95;
	console.log('Buying BHP at 95% of current market value (' + newprice + ')');
	// Issue a buy request for the server.  This function also returns
	// immediately, but gives us a Promise we can use to run code later on once
	// the server has responded.
	b.buy({
		stock: 'BHP',
		quantity: 510,
		price: newprice,
		id: null,

	}).then(function(order) {
		// This callback function will run if the server tells us that it has
		// successfully placed the order.
		console.log('Order successful: ' + order.id + ' at ' + order.price);

	}, function(order) {
		// This callback function will run if the order could not be placed.
		console.log('Order failed: ' + order.error);
	});

	// Another demonstration that this code will run before the buy operation has
	// really started, so this message will appear before the success/fail message
	// above.
	console.log('Buy request has been issued');

	// Retrieve some historical confirmations.  As above, this will operate in
	// parallel with the buy operation, so if you want a confirmation for the
	// order above, this block of code will have to go into the then() block above
	// where the 'order successful' message is printed.  Of course most of the
	// time the confirmation won't appear until many minutes after the order has
	// not only been placed but also fulfilled, so that probably won't work out so
	// well either!
	b.history(
		new Date('2016-01-01'), // start date
		new Date('2016-01-31')  // end date

	).then(function(hist) {
		// Callback function run once server responds with the data.
		console.log('Getting confirmations succeeded:', hist);

	}).catch(function(err) {
		// Callback function to handle an error
		console.log('Getting confirmations failed:', err);
	});

}).catch(function(err) {
	// Callback function in case the original fill_prices() call failed.
	console.log('Getting stock prices failed:', err);
});

// To show that the above callbacks haven't been run yet, we will print this
// message now.  You will notice that this appears very early on in the output
// because it runs as soon as the first HTTP request has been scheduled, while
// we are waiting for the server to respond.  Only once the server responds
// will the above code run - this is how then() works.
console.log('At end of code, now we just wait for the promises to complete.');
