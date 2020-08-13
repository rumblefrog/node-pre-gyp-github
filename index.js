"use strict";

var path = require("path");
var fs = require('fs');
var mime = require("mime-types");
var cwd = process.cwd();

var verbose = false;
var consoleLog = function(x) {
	return (verbose) ? console.log(x) : false;
};

const { Octokit } = require("@octokit/rest");

class NodePreGypGithub {

	constructor() {
		// super();
		this.stage_dir = path.join(cwd, "build", "stage");
	}

	init() {
		console.log("init()");

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
 
		this.octokit = this.octokit || new Octokit({

			auth: process.env.NODE_PRE_GYP_GITHUB_TOKEN,

			baseUrl: 'https://' + this.host,
			headers: {
				"user-agent": (this.package_json.name) ? this.package_json.name : "node-pre-gyp-github"
			}
		});
	}


	authenticate_settings() {
		var token = process.env.NODE_PRE_GYP_GITHUB_TOKEN;
		if (!token) throw new Error(
			//'Please specify NODE_PRE_GYP_GITHUB_TOKEN');
			'NODE_PRE_GYP_GITHUB_TOKEN environment variable not found');

		return {
			"type": "oauth",
			"token": token
		};
	}

	async createRelease(args) {
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
		return this.octokit.repos.createRelease(options);
	}

	async uploadReleaseAsset(cfg) {

		// this.octokit.authenticate(this.authenticate_settings());

		const contentType = mime.contentType(cfg.fileName) || 'application/octet-stream';
		const data = fs.readFileSync(cfg.filePath);

		await this.octokit.repos.uploadReleaseAsset({
			url: this.release.upload_url,
			owner: this.owner,
			id: this.release.id,
			repo: this.repo,
			name: cfg.fileName,
			data,
			contentType
		});
		consoleLog('Staged file ' + cfg.fileName + ' saved to ' + this.owner + '/' + this.repo + ' release ' + this.release.tag_name + ' successfully.');
	}

	async uploadReleaseAssets() {
		var asset;

		consoleLog("Stage directory path: " + path.join(this.stage_dir));

		const pThis = this;

		return new Promise((resolve, reject) => {

			fs.readdir(path.join(this.stage_dir), async (err, files) => {

				if (err) { return reject(err); }

				if (!files.length) {
					return reject(new Error('No files found within the stage directory: ' + this.stage_dir));
				}

				for (const file of files) {

					if (pThis.release && pThis.release.assets) {

						asset = pThis.release.assets.filter((element) => element.name === file);

						if (asset.length) {
							return reject(
								new Error("Staged file " + file + " found but it already exists in release " + this.release.tag_name +
								 ". If you would like to replace it, you must first manually delete it within GitHub."));
						}
					}
					consoleLog("Staged file " + file + " found. Proceeding to upload it.");
					await pThis.uploadReleaseAsset({
						fileName: file,
						filePath: path.join(pThis.stage_dir, file)
					});
				}

				resolve();

			});
		});
	}

	async publish(options) {


		try {

			options = (typeof options === 'undefined') ? {} : options;
			verbose = (typeof options.verbose === 'undefined' || options.verbose) ? true : false;

			if (!process.env.NODE_PRE_GYP_GITHUB_TOKEN) {
				throw new Error("NODE_PRE_GYP_GITHUB_TOKEN environment variable not found");
			}
			this.init();

			// this.octokit.authenticate(this.authenticate_settings());

			const pThis = this;

			const data = await pThis.octokit.repos.listReleases({
				'owner': this.owner,
				'repo': this.repo
			});

			var release;


			// when remote_path is set expect files to be in stage_dir / remote_path after substitution
			if (pThis.package_json.binary.remote_path) {
				options.tag_name = pThis.package_json.binary.remote_path.replace(/\{version\}/g, this.package_json.version);
				pThis.stage_dir = path.join(pThis.stage_dir, options.tag_name);
			} else {
				// This is here for backwards compatibility for before binary.remote_path support was added in version 1.2.0.
				options.tag_name = pThis.package_json.version;
			}
			release = data.data.filter((element, index, array) => element.tag_name === options.tag_name);

			if (release.length === 0) {

				const release = await pThis.createRelease(options);
				pThis.release = release.data;
				if (pThis.release.draft) {
					consoleLog('Release ' + pThis.release.tag_name + " not found, so a draft release was created. YOU MUST MANUALLY PUBLISH THIS DRAFT WITHIN GITHUB FOR IT TO BE ACCESSIBLE.");
				}
				else {
					consoleLog('Release ' + release.tag_name + " not found, so a new release was created and published.");
				}
				await pThis.uploadReleaseAssets(pThis.release.upload_url);
			}
			else {
				pThis.release = release[0];
				await pThis.uploadReleaseAssets();
			}
		} catch (err) {
			throw err;

		}
	}
}







module.exports = NodePreGypGithub;
