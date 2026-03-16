/**
 * PokiSDK no-ad stub - provides all required methods as no-ops.
 * No ad SDK is loaded. For local/offline use.
 * Locked to prevent game from overwriting with remote SDK.
 */
(function() {
	var getParam = function(name) {
		var m = RegExp("[?&]" + name + "=([^&]*)").exec(window.location.search || "");
		return m ? decodeURIComponent(m[1].replace(/\+/g, " ")) : null;
	};
	var noop = function() {};
	var resolveTrue = function() { return Promise.resolve(true); };
	var resolveFalse = function() { return Promise.resolve(false); };
	var resolveVoid = function() { return Promise.resolve(); };
	var rejectVoid = function() { return new Promise(function(_, r) { r(); }); };

	var stub = {
		init: function() { return Promise.resolve(); },
		initWithVideoHB: function() { return Promise.resolve(); },
		commercialBreak: resolveTrue,
		rewardedBreak: resolveFalse,
		displayAd: noop,
		destroyAd: noop,
		gameplayStop: noop,
		gameplayStart: noop,
		getLeaderboard: resolveVoid,
		getSharableURL: rejectVoid,
		getURLParam: function(n) { return getParam("gd" + n) || getParam(n) || ""; },
		customEvent: noop,
		gameLoadingStart: noop,
		gameLoadingFinished: noop,
		gameLoadingProgress: noop,
		gameInteractive: noop,
		roundStart: noop,
		roundEnd: noop,
		muteAd: noop,
		disableProgrammatic: noop,
		setDebug: noop,
		happyTime: noop,
		setPlayerAge: noop,
		togglePlayerAdvertisingConsent: noop,
		toggleNonPersonalized: noop,
		setConsentString: noop,
		logError: noop,
		sendHighscore: noop,
		setDebugTouchOverlayController: noop
	};
	try {
		Object.defineProperty(window, 'PokiSDK', { value: stub, writable: false, configurable: false });
	} catch(e) {
		window.PokiSDK = stub;
	}
})();
