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

});
