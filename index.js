'use strict';

var CommsecBroker = require('./commsec.js');

exports.get_brokers = function() {
	return [CommsecBroker];
}
