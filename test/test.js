"use strict";
var chai = require("chai");
var chaiAsPromised = require("chai-as-promised");
chai.use(chaiAsPromised);
var expect = chai.expect;
require("chai-as-promised");

var fs = require("fs");
var NodePreGypGithub = require('../index.js');
var nodePreGypGithub = new NodePreGypGithub();
var stage_dir = nodePreGypGithub.stage_dir;
var { Octokit } = require("@octokit/rest");
var octokit = {
	repos: {
		listReleases() { return new Promise(resolve=> resolve())},
		createRelease() { return new Promise(resolve=> resolve())},
		uploadReleaseAsset() { return new Promise(resolve=> resolve())}
	}
};
var sinon = require('sinon')
var reset_index = function(index_string_ref) {
	delete require.cache[require.resolve(index_string_ref)];
	return require(index_string_ref);
};

var sandbox = sinon.createSandbox();

function p(err,data) {
	return new Promise((resolve,reject) => err ? reject(err): resolve(data));
}

var reset_mocks = function() {
	sandbox.restore();
	process.env.NODE_PRE_GYP_GITHUB_TOKEN = "secret";
	fs = reset_index('fs');
	fs.readFileSync = function() { return '{"name":"test","version":"0.0.1","repository": {"url":"git+https://github.com/test/test.git"},"binary":{"host":"https://github.com/test/test/releases/download/","remote_path":"{version}"}}'; };

	nodePreGypGithub.stage_dir = stage_dir;
	nodePreGypGithub.octokit = octokit;

	NodePreGypGithub.prototype.octokit = function() { 
		return octokit; 
	};

	// sandbox.stub(octokit, 'authenticate');

	sandbox.stub(octokit.repos, 'listReleases').callsFake(async (options) => {
		return p(null, { data: [{ "tag_name": "0.0.0", "assets": [{ "name": "filename" }] }] });
	});
	sandbox.stub(octokit.repos, 'createRelease').callsFake(async (options) => {
		return p(null, { data: { "tag_name": "0.0.1", "draft": true, "assets": [{}] } });
	});
	sandbox.stub(octokit.repos, 'uploadReleaseAsset').callsFake(async (cfg)  =>{ 
		console.log(cfg);
		return new Promise((resolve)=> { setTimeout(resolve,100); });

	});
};

if (!process.env.COVERALLS_SERVICE_NAME) console.log('To post to coveralls.io, be sure to set COVERALLS_SERVICE_NAME environment variable');
if (!process.env.COVERALLS_REPO_TOKEN) console.log('To post to coveralls.io, be sure to set COVERALLS_REPO_TOKEN environment variable');

describe("Publishes packages to GitHub Releases", async () =>  {

	afterEach(() => {
		sandbox.restore();
		process.env.NODE_PRE_GYP_GITHUB_TOKEN = "secret";
		fs = reset_index('fs');
	});
	describe("Publishes without an error under all options", async () =>  {

		it("should publish without error in all scenarios", async () =>  {
			var log = console.log;

			reset_mocks();
			fs.readdir = function(filename, cb) {
				cb(null, ["filename"]);
			};
			fs.statSync = function() { return 0; }
			console.log = function() { };

			// testing scenario when a release already exists
			expect( nodePreGypGithub.publish()).to.to.eventually.equal(undefined);
			expect( nodePreGypGithub.publish({ 'draft': false, 'verbose': false })).to.to.eventually.equal(undefined);
			expect( nodePreGypGithub.publish({ 'draft': false, 'verbose': true })).to.to.eventually.equal(undefined);
			expect( nodePreGypGithub.publish({ 'draft': true, 'verbose': false })).to.to.eventually.equal(undefined);
			expect( nodePreGypGithub.publish({ 'draft': true, 'verbose': true })).to.to.eventually.equal(undefined);

			// testing scenario when a release does not already exist
			octokit.repos.listReleases = function(options) {
				return p(null, { data: [] });
			};
			octokit.repos.createRelease = function(options) {
				return p(null, { data: { draft: false } });
			};
			expect( nodePreGypGithub.publish()).to.not.be.rejectedWith();
			expect( nodePreGypGithub.publish({ 'draft': false, 'verbose': false })).to.to.eventually.equal(undefined);
			expect( nodePreGypGithub.publish({ 'draft': false, 'verbose': true })).to.to.eventually.equal(undefined);
			octokit.repos.createRelease = function(options) {
				return (null, { data: { draft: true } });
			};
			expect( nodePreGypGithub.publish({ 'draft': true, 'verbose': false })).to.to.eventually.equal(undefined);
			expect( nodePreGypGithub.publish({ 'draft': true, 'verbose': true })).to.to.eventually.equal(undefined);
			fs.readFileSync = function() { return '{"version":"0.0.1","repository": {"url":"git+https://github.com/test/test.git"},"binary":{"host":"https://github.com/test/test/releases/download/","remote_path":"{version}"}}'; };
			expect( nodePreGypGithub.publish()).to.to.eventually.equal(undefined);
			console.log = log;
		});

	});

	describe("Throws an error when node-pre-gyp-github is not configured properly", async () =>  {

		it("should throw an error when missing repository.url in package.json", async () =>  {
			const options = { 'draft': true, 'verbose': false };
			reset_mocks();
			fs.readFileSync = () => { return '{}'; };
			expect( nodePreGypGithub.publish(options)).to.be.rejectedWith("Missing repository.url in package.json");
		});

		it("should throw an error when a correctly formatted GitHub repository.url is not found in package.json", async () =>  {
			const options = { 'draft': true, 'verbose': false };
			reset_mocks();
			fs.readFileSync = function() { return '{"repository": {"url":"bad_format_url"}}'; };
			expect( nodePreGypGithub.publish(options)).to.be.rejectedWith("A correctly formatted GitHub repository.url was not found within package.json");
		});

		it("should throw an error when missing binary.host in package.json", async () =>  {
			const options = { 'draft': true, 'verbose': false };
			reset_mocks();
			fs.readFileSync = function() { return '{"repository": {"url":"git+https://github.com/test/test.git"}}'; };
			expect( nodePreGypGithub.publish(options)).to.be.rejectedWith("Missing binary.host in package.json");
		});

		it("should throw an error when binary.host does not begin with the correct url", async () =>  {
			const options = { 'draft': true, 'verbose': false };
			reset_mocks();
			fs.readFileSync = function() { return '{"repository": {"url":"git+https://github.com/test/test.git"},"binary":{"host":"bad_format_binary"}}'; };
			expect( nodePreGypGithub.publish(options)).to.be.rejectedWith(/^binary.host in package.json should begin with:/i);
		});

		it("should throw an error when the NODE_PRE_GYP_GITHUB_TOKEN environment variable is not found", async () =>  {
			const options = { 'draft': true, 'verbose': false };
			reset_mocks();
			process.env.NODE_PRE_GYP_GITHUB_TOKEN = "";
			expect( nodePreGypGithub.publish(options)).to.be.rejectedWith("NODE_PRE_GYP_GITHUB_TOKEN environment variable not found");
		});

		it("should throw an error when octokit.repos.listReleases returns an error", async () =>  {
			const options = { 'draft': true, 'verbose': false };
			reset_mocks();

			octokit.repos.listReleases.restore();
			
			sandbox.stub(octokit.repos, 'listReleases').callsFake(async (options) => {
				return new Promise((resolve,reject) => reject(new Error('listReleases error')));
			});

			expect(nodePreGypGithub.publish(options)).to.be.rejectedWith('listReleases error');
		});

		it("should throw an error when octokit.repos.createRelease returns an error", async () =>  {
			const options = { 'draft': true, 'verbose': false };
			reset_mocks();
			octokit.repos.listReleases = function(options) {
				return new Promise((resolve)=> resolve({ data: [] })); 
			};
			octokit.repos.createRelease = function(options) {
				return new Promise( (resolve,reject) => {
					reject(new Error('createRelease error'));
				});
			};
			expect(nodePreGypGithub.publish(options)).to.be.rejectedWith('createRelease error');
		});

		it("should throw an error when the stage directory structure is missing", async () =>  {
			const options = { 'draft': true, 'verbose': false };
			reset_mocks();
			fs.readdir = function(filename, cb) {
				cb(new Error('readdir Error'));
			};
			expect( nodePreGypGithub.publish(options)).to.be.rejectedWith('readdir Error');
		});

		it("should throw an error when there are no files found within the stage directory", async () =>  {
			const options = { 'draft': true, 'verbose': false };
			reset_mocks();
			fs.readdir = function(filename, cb) {
				cb(null, []);
			};
			expect( nodePreGypGithub.publish(options)).to.be.rejectedWith(/^No files found within the stage directory:/i);
		});

		it("should throw an error when a staged file already exists in the current release", async () =>  {
			const options = { 'draft': true, 'verbose': false };
			reset_mocks();
			fs.readdir = function(filename, cb) {
				cb(null, ["filename"]);
			};
			octokit.repos.listReleases = function(options) {
				return p(null,{ data: [{ "tag_name": "0.0.1", "assets": [{ "name": "filename" }] }] });
			};
			expect( nodePreGypGithub.publish(options)).to.be.rejectedWith(/^Staged file .* found but it already exists in release .*. If you would like to replace it, you must first manually delete it within GitHub./i);
		});

		it("should throw an error when github.releases.uploadReleaseAsset returns an error", async () =>  {
			const options = { 'draft': true, 'verbose': false };
			reset_mocks();
			fs.readdir = function(filename, cb) {
				cb(null, ["filename"]);
			};
			octokit.repos.uploadReleaseAsset = function() {
			   return p(new Error('uploadReleaseAsset error'));
			};
			expect( nodePreGypGithub.publish(options)).to.be.rejectedWith("uploadReleaseAsset error");
		});

	});

	describe("Verify backwords compatible with any breaking changes made within the same MINOR version.", async () =>  {

		it("should publish even when package.json's binary.remote_path property is not provided and instead the version is hard coded within binary.host", async () =>  {
			const options = { 'draft': false, 'verbose': false };
			reset_mocks();
			fs.readFileSync = function() { return '{"name":"test","version":"0.0.1","repository": {"url":"git+https://github.com/test/test.git"},"binary":{"host":"https://github.com/test/test/releases/download/0.0.1"}}'; };
			fs.readdir = function(filename, cb) {
				cb(null, ["filename"]);
			};
			fs.statSync = function() { return 0; }
			octokit.repos.createRelease = function(options) {
				return { data: { "tag_name": "0.0.1", "draft": false, "assets": [{}] } };
			};
			expect( nodePreGypGithub.publish(options)).to.to.eventually.equal(undefined);
		});

	});
});
