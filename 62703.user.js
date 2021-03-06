// ==UserScript==
// @author       Tim McCormack
// @maintainer   Christopher <4Christopher@gmx.de>
// @license      Eclipse Public License (EPL)
// @name         OKCupid questions downloader (data compat: v2)
// @namespace    tag:brainonfire.net,2009-11-17:okcupid-questions-downloader
// @description  Download your answers to OKCupid match questions as JSON. (This takes a while.) http://www.okcupid.com/questions
// @todo         Read created questions
// @include      /^https?://www\.okcupid\.com/(?:profile/.*/)?questions.*$/
// @require      http://code.jquery.com/jquery-1.3.2.js
// @version      2.3 testing
// @changelog    Since 2.1: Actually output JSON, not just serialized JS.
// @grant        GM_registerMenuCommand
// ==/UserScript==

// For Greasemonkey users
GM_registerMenuCommand("Harvest question data", main);
// For users of other userscript plugins
$('.questions').prevAll('h2').append(" <button>Export</button>").find('button').click(main);

// personal
var username;

// constants
var nominalPerPage = 10;
var pageBy = nominalPerPage - 2;
var questCats = ['recent']; // indexed by `stage`
// var questCats = ['recent', 'skipped']; // indexed by `stage`
// var questCats = ['skipped']; // indexed by `stage`

// DOM
var loaderFrame;
var infobox;
var statusLine;
var eventList;
var outputBox;

// state
var curLow;
var questions    = {};
var stage        = 0;
var hasStarted   = true;
var testing_mode = false;
var debug_mode   = false;

/**
 * Run main sequence.
 */
function main() {
	username = unsafeWindow.SCREENNAME;
	makeGUI();

	// hasStarted = false; // uncomment this to prevent full run (will make GUI and ask for one page)
	// testing_mode = true; // uncomment to only evaluate one page.
	debug_mode = true; // uncomment to get debug output.

	// activate
	loaderFrame.addEventListener('load', receivePage_, false);

	prepForScrape_();
}
// main();

// Create infobox and loader frame {{{
function makeGUI() {
	// Create info box {{{
	infobox = document.createElement('div');
	infobox.id = "qdown-info";
	$(infobox).css(
			{
				border             : "1px solid black",
				position           : "absolute",
				width              : "500px",
				right              : "0px",
				top                : "0px",
				"background-color" : "#aaa",
				opacity            : ".9",
				"z-index"          : 300
			}
		);
	// }}}

	// statusLine {{{
	statusLine = document.createElement('p');
	$(statusLine).css(
			{
				border       : "3px solid black",
				font         : "bold 15px monospace",
				padding      : "5px",
				"min-height" : "3em"
			}
		).text("Initializing...");
	infobox.appendChild(statusLine);

	eventList = document.createElement('ol');
	$(eventList).css(
			{
				border       : "1px solid green",
				"overflow-y" : "scroll",
				height       : "6em",
				margin       : "5px auto",
				width        : "95%"
			}
		);
	infobox.appendChild(eventList);
	// }}}

	// outputBox {{{
	outputBox = document.createElement('textarea');
	outputBox.setAttribute('rows', 10);
	$(outputBox).css(
			{
				width   : "95%",
				display : 'block',
				margin  : "10px auto"
			}
		);
	outputBox.value = "Output JSON will appear here...";
	infobox.appendChild(outputBox);

	loaderFrame = document.createElement('iframe');
	loaderFrame.id = "qdown-loader";
	$(loaderFrame).css(
			{
				width:"95%",
				display:'block',
				margin:"5px auto",
				border:"1px solid yellow",
				height:"100px"
			}
		);
	infobox.appendChild(loaderFrame);
	// }}}

	document.body.appendChild(infobox);
}
// }}}

/**
 * Finish XHR chain, display results.
 */
function finish() {
	// Remove this line for older Firefox and Chrome that don't have JSON object:
	var uneval = JSON.stringify;

	outputBox.value = uneval(
			{
				data    : questions,               /*# Questions #*/
				version : 2,                       /*# Integer: 2 #*/
				date    : new Date().toUTCString() /*# String (date in RFC 822 with UTC timezone) #*/
			}
		);

	updateStatus('Done!');
}

/*=====================*
 * Core loop functions *
 *=====================*/

/**
 * 0. Gather required info for scraping answered questions.
 */
function prepForScrape_() {
	console.log('Starting stage '+stage+': '+questCats[stage]);

	if (testing_mode) {
		curLow = 100;
	} else {
		curLow = 1;
	}

	scrapeRest_();
}

/**
 * 1. Start a request for the current offset.
 */
function scrapeRest_() {
	updateStatus('Requesting at most '+nominalPerPage+' questions starting at #'+curLow);

	if (testing_mode) { // Use self_notes in testing mode to show questions on which you added notes.
		loaderFrame.src = '/questions?self_notes=1'; // goto 2 (trigger)
	} else {
		loaderFrame.src = '/questions?low='+curLow+'&'+questCats[stage]+'=1'; // goto 2 (trigger)
	}
}

/**
 * 2. Harvest data from loaded page.
 */
function receivePage_() {
	if(!hasStarted) {
		return; // don't fire for initializing iframe
	}

	updateStatus('Loaded page starting at '+curLow);

	// Does not stop because even on a empty page there is a question embedded.
	var qs = jQuery(".questions .question", loaderFrame.contentDocument);
	if(qs.length == 0) {
		console.log('length == 0');
		return bumpStage_(); // goto 3
	}
	console.log(qs.length)
	qs.each(processQuestion);

	curLow += pageBy;
	if (!testing_mode) {
		scrapeRest_(); // goto 1
	}
}

function processQuestion(i, el) {
	//updateStatus("Reading "+i+"th question.");

	var $q = jQuery(el);

	var qID = $q.attr('id').replace(/^question_([0-9]+)$/, '$1');
	var qHTML = $q.find('div.qtext > p').html();
	var isSkipped = $q.hasClass('not_answered');
	if (debug_mode) {
		// console.log('Parsing question: ' + qID);
		console.log('\tQuestion text is: ' + qHTML);
		console.log('\tQuestion skipped: ' + isSkipped);
	}

	var explanation = null;
	var isPublic    = null;
	var importance  = null;
	var answers     = null;

	if(!isSkipped) {
		if ($q.hasClass('has_explanation')) {
			explanation = $q.find('div.your_explanation > p.value').text() || null;
			if (debug_mode) {
				// console.log('\tExplanation: ' + explanation);
			}
		}
		isPublic = $q.hasClass('public');
		var importance_internal_number = Number($q.find('div.importance_radios > label.checked').attr('data-count'));
		importance = 5 - importance_internal_number; // regularize from [4,1] to [0,4]
		if (debug_mode) {
			// console.log('\tIs public: ' + isPublic);
			// console.log('\tImportance internal number: ' + importance_internal_number);
			// console.log('\tImportance converted number: ' + importance);
		}
		answers = {};
		$q.find('.self_answers > li').each(function processAnswer(i, el) {
			var $a       = $(el);
			var aID      = Number($a.attr('id').replace(/.*_/gi, ''));
			var aText    = $a.html();
			var isMine   = $a.hasClass('mine');
			var isMatch  = $a.hasClass('match');
			answers[aID] = {
				text    : aText,  /*# String #*/
				isMine  : isMine, /*# Boolean (true if I answered this way) #*/
				isMatch : isMatch /*# Boolean (true if ideal match would answer this way) #*/
			};
		});
	}

	questions[qID] = {
		text: qHTML,              /*# String #*/
		isSkipped: isSkipped,     /*# Boolean # Null if isSkipped */
		explanation: explanation, /*# String #*/
		isPublic: isPublic,       /*# Boolean #*/
		importance: importance,   /*# Integer:[0,4] (irrelevant to mandatory) #*/
		answers: answers,         /*# Answers #*/
		lowNumber: curLow		  /*# On which page. OkCupid does not search you for questions which you might want to do if you want to change your answer. #*/
	};
	finish();
}

/**
 * 3. Jump to next stage.
 */
function bumpStage_() {
	updateStatus("Done with stage "+stage+": "+questCats[stage]);
	stage++;
	if(stage >= questCats.length) {
		return finish();
	}

	prepForScrape_(); // goto 0
}

/*==================*
 * Helper functions *
 *==================*/

/**
 * Update the status text.
 */
function updateStatus(msg) {
	console.log('Status: ' + msg);
	$(statusLine).text(msg);

	var line = document.createElement('li');
	line.appendChild(document.createTextNode(msg));
	eventList.appendChild(line);
}
