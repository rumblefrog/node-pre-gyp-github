#!/usr/bin/env node

var NodePreGypGithub = require('../index.js');
var program = require('commander');

console.log("running https://github.com/OpenWebCAD/node-pre-gyp-github.git");

program
	.command('publish [options]')
	.description('publishes the contents of .\\build\\stage\\{version} to the current version\'s GitHub release')
	.option("-r, --release", "publish immediately, do not create draft")
	.option("-s, --silent", "turns verbose messages off")
	.action(function(cmd, options) {
		var opts = {};
		opts.draft = options.release ? false : true;
		opts.verbose = options.silent ? false : true;

		const nodePreGypGithub = new NodePreGypGithub();
		nodePreGypGithub.publish(opts);
	});

program
	.command('help', '', { isDefault: true, noHelp: true })
	.action(function() {
		console.log();
		console.log('Usage: node-pre-gyp-github publish');
		console.log();
		console.log('publishes the contents of .\\build\\stage\\{version} to the current version\'s GitHub release');
	});

program.parse(process.argv);

if (!program.args.length) {
	program.help();
}
