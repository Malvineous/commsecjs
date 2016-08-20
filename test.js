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

/*
b.fill_prices(stocks).then(function(s) {
	console.log(stocks);
});
*/

b.buy({
	stock: 'GEM',
	quantity: 510,
	price: '3',
	id: null,
}).then(function(order) {
	console.log('Order successful: ' + order.id);
}, function(order) {
	console.log('Order failed: ' + order.error);
});
