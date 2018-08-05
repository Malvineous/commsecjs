// CommSec mobile API NodeJS interface example.
// Copyright 2016-2018 Adam Nielsen <malvineous@shikadi.net>

// You'd normally use this line of course.
//const Commsec = require('commsec');

// But we have to do things differently because this example is inside the
// commsec package.
const Commsec = require('./index.js');

// Everything is wrapped inside an async function so we can 'await'.
async function run()
{
	let commsec = new Commsec();

	// You can also enable debugging if needed.
	/*
	let commsec = new Commsec({
		// This option shows what the library is trying to do.
		debug: true,

		// This option displays all the JSON server responses, which is
		// useful when deciphering the API.
		dumpServerResponses: true,
	});
	*/

	// The device ID is allocated upon a successful login.  You should store it
	// somewhere and supply it on subsequent logins.  It's possible that not doing
	// so will cause older device IDs to get deleted, breaking the login on the
	// real app.
	let deviceId = null;

	// Set the credentials.  You'd normally load these from a secure location,
	// such as an environment variable or a file outside any git repository.
	let creds = {
		"clientId": "12345678",
		"deviceId": deviceId,
		"loginType": "password",
		"password": "secret",
	};

	// If you have a PIN set up and have remembered the device ID from an earlier
	// password login, you can log in with the PIN instead.
	/*
	let creds = {
		"clientId": "12345678",
		"deviceId": "abcdefghijklmnopqrstuvwxyz0123456789%3d",
		"loginType": "pin",
		"password": "1234",
	};
	*/

	// Attempt the login.  If this fails while you're testing, remember to log in
	// via the web site or app after two failed attempts, to avoid your account
	// getting locked for three failed logins in a row.  If it does get locked,
	// it's an easy phone call to get it unlocked again though, so no big deal.
	let loginResponse;
	try {
		loginResponse = await commsec.login(creds);
	} catch (e) {
		console.log('Unable to log in:', e.message);
		return;
	}

	if (loginResponse.deviceId) {
		// If you get a new device ID, you should save it and use it for future
		// logins.  It doesn't seem to time out so you can just add it to your
		// credential store along with your password.
		console.log('Received a new device ID:', loginResponse.deviceId);
	}

	// List the trading accounts.
	loginResponse.accounts.forEach(a => {
		console.log('Account name:', a.name);
	});

	// Show any watchlists.
	try {
		let w = await commsec.getWatchlists();
		w.lists.forEach(list => {
			console.log('Watchlist', list.id);
			list.items.forEach(i => {
				console.log(`  ${i.code} @ \$${i.lastPrice} / ${i.volume}\tO:${i.offer} H:${i.high} L:${i.low}`);
			});
		});
	} catch (e) {
		console.log('Error retrieving watchlist:', e.message);
	}

	// Show any holdings.
	try {
		let h = await commsec.getHoldings();
		h.entities.forEach(entity => {
			console.log('Entity', entity.entityName);
			entity.accounts.forEach(account => {
				console.log(' - Account', account.accountNumber, account.entityName);
				account.holdings.forEach(holding => {
					console.log(`     ${holding.code}: ${holding.availableUnits} @ ${holding.purchasePrice}`);
				});
			});
			console.log(' - Cash accounts:', entity.cashAccounts.length);
			console.log(' - International accounts:', entity.internationalAccounts.length);
			console.log(' - Margin loans:', entity.marginLoans.length);
		});
	} catch (e) {
		console.log('Error retrieving holdings:', e.message);
	}

	// This example shows polling of stocks.  These stocks do not have to be on a
	// watchlist.  When the value is returned, a hash is supplied.  This hash is
	// included in subsequent requests so that data is only returned when it has
	// changed.
	let stockList = {
		"ANZ": null,
		"CBA": null,
		"NAB": null,
		"WBC": null,
	};
	setInterval(async () => {
		console.log('Polling stocks');
		let stockInfosResponse = await commsec.pollStocks(stockList);
		stockInfosResponse.stockInfos.forEach(stock => {
			console.log(`[${stock.code}] Updated \$${stock.lastPrice} B:${stock.bid} A:${stock.offer}`);
			// Record the hash for the next call
			stockList[stock.code] = stock.hash;
		});
	}, 2000);
}

run();
