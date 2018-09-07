/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const bootstrap = require('./bootstrap');

exports.parseURLQueryArgs = function () {
	const search = window.location.search || '';

	return search.split(/[?&]/)
		.filter(function (param) { return !!param; })
		.map(function (param) { return param.split('='); })
		.filter(function (param) { return param.length === 2; })
		.reduce(function (r, param) { r[param[0]] = decodeURIComponent(param[1]); return r; }, {});
};

exports.assign = function (destination, source) {
	return Object.keys(source).reduce(function (r, key) { r[key] = source[key]; return r; }, destination);
};

exports.load = function (modulePath, loaderCallback, resultCallback) {
	const fs = require('fs');
	const ipc = require('electron').ipcRenderer;

	const args = exports.parseURLQueryArgs();
	const configuration = JSON.parse(args['config'] || '{}') || {};

	// Correctly inherit the parent's environment
	exports.assign(process.env, configuration.userEnv);

	// Enable ASAR support
	bootstrap.enableASARSupport();

	// Get the nls configuration into the process.env as early as possible.
	const nlsConfig = bootstrap.setupNLS();

	let locale = nlsConfig.availableLanguages['*'] || 'en';
	if (locale === 'zh-tw') {
		locale = 'zh-Hant';
	} else if (locale === 'zh-cn') {
		locale = 'zh-Hans';
	}

	window.document.documentElement.setAttribute('lang', locale);

	// Allow some basic keybindings
	const TOGGLE_DEV_TOOLS_KB = (process.platform === 'darwin' ? 'meta-alt-73' : 'ctrl-shift-73'); // mac: Cmd-Alt-I, rest: Ctrl-Shift-I
	const RELOAD_KB = (process.platform === 'darwin' ? 'meta-82' : 'ctrl-82'); // mac: Cmd-R, rest: Ctrl-R

	const extractKey = function (e) {
		return [
			e.ctrlKey ? 'ctrl-' : '',
			e.metaKey ? 'meta-' : '',
			e.altKey ? 'alt-' : '',
			e.shiftKey ? 'shift-' : '',
			e.keyCode
		].join('');
	};

	window.addEventListener('keydown', function (e) {
		const key = extractKey(e);
		if (key === TOGGLE_DEV_TOOLS_KB) {
			ipc.send('vscode:toggleDevTools');
		} else if (key === RELOAD_KB) {
			ipc.send('vscode:reloadWindow');
		}
	});

	// Load the loader
	const loaderFilename = configuration.appRoot + '/out/vs/loader.js';
	const loaderSource = fs.readFileSync(loaderFilename);

	loaderCallback(loaderFilename, loaderSource, function (loader) {
		const define = global.define;
		global.define = undefined;

		window.nodeRequire = loader.__$__nodeRequire;

		// replace the patched electron fs with the original node fs for all AMD code
		define('fs', ['original-fs'], function (originalFS) { return originalFS; });

		window.MonacoEnvironment = {};

		loader.config({
			baseUrl: bootstrap.uriFromPath(configuration.appRoot) + '/out',
			'vs/nls': nlsConfig,
			nodeCachedDataDir: configuration.nodeCachedDataDir,
			nodeModules: [/*BUILD->INSERT_NODE_MODULES*/]
		});

		if (nlsConfig.pseudo) {
			loader(['vs/nls'], function (nlsPlugin) {
				nlsPlugin.setPseudoTranslation(nlsConfig.pseudo);
			});
		}

		loader([modulePath], result => resultCallback(result, configuration));
	});
};