CommSec trading interface for node.js
=====================================
**Copyright 2016-2018 Adam Nielsen <<malvineous@shikadi.net>>**

This is a node.js interface to the CommSec mobile API.  It was created by
deciphering the calls made by the Android app.

While the older v0.1 of this library used screen-scraping, v0.2 has been
rewritten to use only the mobile API, which is much faster and more reliable.
Unlike v0.1, little attempt has been made to abstract the API into a generic
interface so there is now only a lightweight wrapper around the API calls.

Be aware that while v0.1 supported placing trades, this ability has not yet made
it into v0.2 however it will be coming soon.

Installation
------------

    npm install commsec

Example
-------

See `example.js` for details.
