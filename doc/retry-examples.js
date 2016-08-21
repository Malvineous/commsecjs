var Promise = require('promise');

function attempt(count, fn, fulfill, reject)
{
	new Promise(fn).then(function(f) {
		fulfill(f);
	}, function(err) {
		if (count <= 1) {
			reject(err);
		} else {
			attempt(count - 1, fn, fulfill, reject);
		}
	});
}

function retry(count, fn) {
	return new Promise(function(fulfill, reject) {
		attempt(count, fn, fulfill, reject);
	});
}

// This is the number of attempts, so we can pretend to fail the first few times
// and succeed later.
var _x = 0;

var fn = function(fulfill, reject) {
	_x++;
	if (_x <= 2) { // Fail the first two times
		console.log('attempt ' + _x + ', going to fail');
		reject(_x);
	} else {
		// Succeed
		console.log('attempt ' + _x + ', going to succeed');
		fulfill(_x);
	}
};

retry(3, fn).then(function(t) {
	console.log('operation succeeded');
}, function(t) {
	console.log('operation failed');
});



var Request = require('request');

var fnWeb = function(fulfill, reject) {
	Request
		.get('http://time.gov/actualtime.cgi',
			function(err, response, body) {
				var time = body.match(/time="([0-9]*)"/)[1];
				console.log('Time is: ' + time);
				if (time % 2 == 0) {
					// This is a good time (even number)
					console.log(' - that is an even number, so we will succeed');
					fulfill(time);
				} else {
					// This is a bad time (odd number)
					console.log(' - that is an odd number, so we will fail');
					reject(time);
				}
			})
	;
};

// To see what happens when this fails, you might need to lower the number of
// retries to 1 (which means one attempt, or no retries).
retry(2, fnWeb).then(function(t) {
	console.log('operation succeeded, even time is: ' + t);
}, function(t) {
	console.log('operation failed, odd time is: ' + t);
});
