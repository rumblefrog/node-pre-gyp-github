"use strict";

var path = require("path");
var fs = require('fs');
var mime = require("mime-types");
var cwd = process.cwd();

var verbose = true;
var consoleLog = function(x) {
	return (verbose) ? console.log(x) : false;
};

function NodePreGypGithub() { }
NodePreGypGithub.prototype.octokit = require("@octokit/rest");
NodePreGypGithub.prototype.stage_dir = path.join(cwd, "build", "stage");
NodePreGypGithub.prototype.init = function() {
	var ownerRepo, hostPrefix;

	this.package_json = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json')));

	if (!this.package_json.repository || !this.package_json.repository.url) {
		throw new Error('Missing repository.url in package.json');
	}
	else {
		ownerRepo = this.package_json.repository.url.match(/https?:\/\/([^\/]+)\/(.*)(?=\.git)/i);
		if (ownerRepo) {
			this.host = 'api.' + ownerRepo[1];
			ownerRepo = ownerRepo[2].split('/');
			this.owner = ownerRepo[0];
			this.repo = ownerRepo[1];
		}
		else throw new Error('A correctly formatted GitHub repository.url was not found within package.json');
	}

	hostPrefix = 'https://' + this.host + '/' + this.owner + '/' + this.repo + '/releases/download/';
	if (!this.package_json.binary || 'object' !== typeof this.package_json.binary || 'string' !== typeof this.package_json.binary.host) {
		throw new Error('Missing binary.host in package.json');
	}
	else if (this.package_json.binary.host.replace('https://', 'https://api.').substr(0, hostPrefix.length) !== hostPrefix) {
		throw new Error('binary.host in package.json should begin with: "' + hostPrefix + '"');
	}

	this.octokit = NodePreGypGithub.prototype.octokit({
		baseUrl: 'https://' + this.host,
		headers: {
			"user-agent": (this.package_json.name) ? this.package_json.name : "node-pre-gyp-github"
		}
	});
};

NodePreGypGithub.prototype.authenticate_settings = function() {
	var token = process.env.NODE_PRE_GYP_GITHUB_TOKEN;
	if (!token) throw new Error(
		//'Please specify NODE_PRE_GYP_GITHUB_TOKEN');
		'NODE_PRE_GYP_GITHUB_TOKEN environment variable not found');

	return {
		"type": "oauth",
		"token": token
	};
};

NodePreGypGithub.prototype.createRelease = function(args, callback) {
	var options = {
		'host': this.host,
		'owner': this.owner,
		'repo': this.repo,
		'tag_name': this.package_json.version,
		'target_commitish': 'master',
		'name': 'v' + this.package_json.version,
		'body': this.package_json.name + ' ' + this.package_json.version,
		'draft': true,
		'prerelease': false
	};

	Object.keys(args).forEach(function(key) {
		if (args.hasOwnProperty(key) && options.hasOwnProperty(key)) {
			options[key] = args[key];
		}
	});
	//xx this.octokit.authenticate(this.authenticate_settings());
	this.octokit.repos.createRelease(options, callback);
};

NodePreGypGithub.prototype.uploadReleaseAsset = function(cfg) {

	// this.octokit.authenticate(this.authenticate_settings());

	const contentType= mime.contentType(cfg.fileName) || 'application/octet-stream';
	const data= fs.readFileSync(cfg.filePath);

	this.octokit.repos.uploadReleaseAsset({
		url: this.release.upload_url,
		owner: this.owner,
		id: this.release.id,
		repo: this.repo,
		name: cfg.fileName,
		data,
		contentType
	}, function(err) {
		if (err) throw err;
		consoleLog('Staged file ' + cfg.fileName + ' saved to ' + this.owner + '/' + this.repo + ' release ' + this.release.tag_name + ' successfully.');
	}.bind(this));
};

NodePreGypGithub.prototype.uploadReleaseAssets = function() {
	var asset;
	consoleLog("Stage directory path: " + path.join(this.stage_dir));
	fs.readdir(path.join(this.stage_dir), function(err, files) {
		if (err) throw err;

		if (!files.length) throw new Error('No files found within the stage directory: ' + this.stage_dir);

		files.forEach(function(file) {
			if (this.release && this.release.assets) {
				asset = this.release.assets.filter(function(element, index, array) {
					return element.name === file;
				});
				if (asset.length) {
					throw new Error("Staged file " + file + " found but it already exists in release " + this.release.tag_name + ". If you would like to replace it, you must first manually delete it within GitHub.");
				}
			}
			consoleLog("Staged file " + file + " found. Proceeding to upload it.");
			this.uploadReleaseAsset({
				fileName: file,
				filePath: path.join(this.stage_dir, file)
			});
		}.bind(this));
	}.bind(this));
};

NodePreGypGithub.prototype.publish = function(options) {
	options = (typeof options === 'undefined') ? {} : options;
	verbose = (typeof options.verbose === 'undefined' || options.verbose) ? true : false;

	if (!process.env.NODE_PRE_GYP_GITHUB_TOKEN) {
		throw new Error("NODE_PRE_GYP_GITHUB_TOKEN environment variable not found");
	}
	this.init();

	// this.octokit.authenticate(this.authenticate_settings());

	this.octokit.repos.listReleases({
		'owner': this.owner,
		'repo': this.repo
	}, function(err, data) {
		var release;
		if (err) throw err;

		// when remote_path is set expect files to be in stage_dir / remote_path after substitution
		if (this.package_json.binary.remote_path) {
			options.tag_name = this.package_json.binary.remote_path.replace(/\{version\}/g, this.package_json.version);
			this.stage_dir = path.join(this.stage_dir, options.tag_name);
		} else {
			// This is here for backwards compatibility for before binary.remote_path support was added in version 1.2.0.
			options.tag_name = this.package_json.version;
		}
		release = data.data.filter(function(element, index, array) {
			return element.tag_name === options.tag_name;
		});
		if (release.length === 0) {
			this.createRelease(options, function(err, release) {
				if (err) throw err;
				this.release = release.data;
				if (this.release.draft) {
					consoleLog('Release ' + this.release.tag_name + " not found, so a draft release was created. YOU MUST MANUALLY PUBLISH THIS DRAFT WITHIN GITHUB FOR IT TO BE ACCESSIBLE.");
				}
				else {
					consoleLog('Release ' + release.tag_name + " not found, so a new release was created and published.");
				}
				this.uploadReleaseAssets(this.release.upload_url);
			}.bind(this));
		}
		else {
			this.release = release[0];
			this.uploadReleaseAssets();
		}
	}.bind(this));
};

module.exports = NodePreGypGithub;
