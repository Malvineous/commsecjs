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

b.fill_prices(stocks).then(function(s) {
	console.log(stocks);

	var newprice = stocks['BHP'].price * 0.95;
	console.log('Buying BHP at 95% of current market value (' + newprice + ')');
	b.buy({
		stock: 'BHP',
		quantity: 510,
		price: newprice,
		id: null,
	}).then(function(order) {
		console.log('Order successful: ' + order.id + ' at ' + order.price);
	}, function(order) {
		console.log('Order failed: ' + order.error);
	});
});

// cs_connect_if_needed() isn't really needed (and will cause two parallel
// connection attempts because fill_prices() above will also try to connect)
// so probably best to avoid it, but it's here to serve as an example of how
// it should be used, if you are inclined to use it at the start of your code
// so you can more accurately detect login failures.
b.cs_connect_if_needed().then(function() {
	b.cs_get_confirmations_range(new Date('2016-01-01'), new Date('2016-01-31')).then(function(list) {
		console.log('Getting confirmations succeeded:');
		console.log(list);
	}, function(err) {
		console.log('Getting confirmations failed: ' + err);
	});
});
