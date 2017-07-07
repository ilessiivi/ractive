/* eslint-env node */

const base = require('./base.conf');

module.exports = function (config) {
	config.set(Object.assign({}, base, {
		plugins: base.plugins.concat(['karma-coverage', 'karma-phantomjs-launcher']),
		browsers: ['PhantomJS'],
		reporters: base.reporters.concat(['coverage']),
		coverageReporter: {
			dir: './coverage/',
			subdir: 'phantom',
			reporters: [
				{ type: 'html' },
				{ type: 'json' },
			]
		},
		files: [
			'qunit/qunit-html.js',
			'qunit/simulant.js',
			'ractive.js',
			'tests-browser.js',
			{ pattern: 'qunit/*.gif', served: true, included: false, watched: false, nocache: false },
		],
		proxies: {
			'/qunit/': '/base/qunit/'
		}
	}));
};
