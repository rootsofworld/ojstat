let cheerio = require('cheerio');
let request = require('request');
let fs = require('fs');

var problemId = process.argv[2];

function getNccuOjResult( problemId, account, passwd ) {

	let firstPage = 1;
	let totalPage = 1;
	let pageCounter = 1;

	let data = {
			list : [], // list : [ {Answer},{Answer},{Answer}, ... ]

			filterByScore :　function(){ //sort with userId then score

				let currentID;
				let highestScoreRecord;

				this.list = this.list.sort( ( a , b ) => {
				
					if (a.userId > b.userId) {
					return 1;
					}
					if (a.userId < b.userId) {
					return -1;
					}
					return 0;

				})
				//return this.list;
				let filteredList = [];

				this.list.forEach(( d, i, list ) => {
					
					if( currentID !== undefined && currentID !== d.userId ){
						//if previous ID's highest score record has been taken
						filteredList.push( highestScoreRecord );
						currentID = d.userId;
						highestScoreRecord = null;
					
					}else{
						currentID = d.userId;
					}
					if( !highestScoreRecord ){
						highestScoreRecord = d;
					}else if( d.result.score > highestScoreRecord.result.score ){
						highestScoreRecord = d;
					}

					if( i === list.length - 1 ) filteredList.push( highestScoreRecord );
				})

				return filteredList;
			
			},

			toCSV : function( list ){

				let csv = list.map(( data ) => {

					return `${data.answerId}, ${data.userId}, ${data.result.score}, ${data.time}`;

				})

				return csv.join('\n');

			}
		};

	//answer record data structure
	function Answer(answerId, userId, result, time, sourcecode) {

		this.answerId = answerId;
		this.userId = userId;
		this.result = result; //{state:'', score:''}
		this.time = time;
		this.sourcecode = sourcecode;

	}

	request.post({
			url: 'http://judge.nccucs.org/Login',
			form: {
				'Account': account,
				'UserPasswd': passwd
			}
		},
		(err, res, body) => {

			if (err) throw err;
			let $ = cheerio.load(body);
			if( $('.ThemeOfficeMainFolderText') === null ) {
				console.error('Login Failed : Wrong username or password (๑•́ ₃ •̀๑)');
				process.exit(1);
			}
			//set cookie to be login state
			//using jar
			let cookieStr = res.headers['set-cookie'][0];
			cookieStr = cookieStr.substring(0, cookieStr.indexOf(';')); //'key=value'
			let j = request.jar();
			let cookie = request.cookie(cookieStr);
			let url = `http://judge.nccucs.org/RealtimeStatus?problemid=${problemId}&page=${firstPage}`;
			j.setCookie(cookie, url);
			request({
				url: url,
				jar: j
			}, (err, res, body) => {

				if (err) throw err;
		
				let $ = cheerio.load(body, {
					ignoreWhitespace: true,
					xmlMode: false
				});

				if( $('#tabmenu').text() === "" ) { 
					console.error('Wrong : This Problem is not exist (๑•́ ₃ •̀๑)');
					process.exit(1);
				}

				//get the number of pages
				console.log(`Page ${firstPage} is processing...`);
				let table = $('#tabmenu').next();
				let getPageTotal = /\d+(?=\W{2}\sLast Page)/g;
				let totalPage = getPageTotal.exec(table.next().html())[0];


				//Emit page 2 ~ last page request
				for (let currentPage = 2; currentPage <= totalPage; currentPage++) {

					console.log(`Page ${currentPage} is Processing...`);
					var url = `http://judge.nccucs.org/RealtimeStatus?problemid=${problemId}&page=${currentPage}`;
					j.setCookie(cookie, url);
					request({
						url: url,
						jar: j
					}, (err, res, body) => {

						if (err) throw err;

						let $ = cheerio.load(body, {

							ignoreWhitespace: true,
							xmlMode: false

						});
						let table = $('#tabmenu').next();
						let content = table.children().nextAll();
						data.list.concat(dataExtract(content, cookie));
						console.log(`Page ${currentPage} is Done`);
						pageCounter++;
						if( pageCounter === +totalPage ) allFinished( cookie );
					})
						
				}
				//page 1 's Data extraction
				let content = table.children().nextAll();
				data.list.concat(dataExtract(content, cookie));
				console.log(`Page ${firstPage} is Done`);

				//console.log("Data extracted. Now output to CSV file...");

			})
		})


		function dataExtract(content, cookie) { //Run one time per page

			let l = content.length; //The number of answers in one page
			while (l > 0) {

				//console.log(content.html());
				let answerIdExp = /\d*(?=<\/td>)/g;
				let answerId = answerIdExp.exec(content)[0];// EX : 82019
				let userIdExp = /\w+(?=<\/a>\s<\/td>)/g;
				let userId = userIdExp.exec(content)[0]; // EX : sp105753000
				let result = (() => {

					let stateExp = /\w+(?=<\/a>\s<span)/g;
					let state = stateExp.exec(content)[0]; // AC or WA or others
					let score;

					if( state === 'AC' ){

						score = 100;
					
					}else if( state === 'CE' ){
					
						score = 0; 
					
					}else{
					
						let scoreExp = /\w+(?=\)\s<\/span>\s<\/td>)/g;
						score = scoreExp.exec(content)[0];
					
					}

					return {
						state: state,
						score: score
					};

				})();
				let timeExp = /\d+-\d+-\w+\s\w+:\d+/g;
				let time = timeExp.exec(content)[0];
				let record = new Answer( answerId, userId, result, time );
				data.list.push(record);
				content = content.next();
				l--;

			}
		}

		function allFinished( cookie ){
			let fdata = data.filterByScore();
			console.log("Data extracted. Now output to CSV file...");;
			fs.writeFile( `result_${problemId}.csv`, data.toCSV(fdata), (err) => {

				if ( err ) throw err;

				let currentTime = getDateTime();
				fs.mkdirSync(`./sourceCode/${problemId}_${currentTime}`, '0777');
				let j = request.jar();
				let counter = fdata.length;
				console.log("Get source Codes ...");
				fdata.forEach((d) => {
					let url = `http://judge.nccucs.org/ShowCode?solutionid=${d.answerId}`;
					j.setCookie(cookie, url);
					request({
						url: url,
						jar: j
					}, (err, res, body) => {

						let $ = cheerio.load(body);
						let pl = $('textarea').attr('class');
						let fe;
						if( pl === 'C'){
							fe = 'c';
						}else if( pl === 'C++' ){
							fe = 'cpp';
						}else{
							fe = 'java';
						}
						let headReg = /"readonly">/g;
						let tailReg = /<\/textarea>/g;
						let head = headReg.exec(body);
						let tail = tailReg.exec(body);
						let b = body.substring(head.index+head[0].length, tail.index);
						fs.writeFile( `./sourceCode/${problemId}_${currentTime}/${d.userId}-${d.answerId}-${d.time.substring(0,10)}.${fe}`, b , (err) => {
							if(err) throw err;
							counter--;
							if(counter === 0) console.log('Finished');
						})
					})
				})
				//console.log('Finished');

			});

		}

}

function getDateTime() {

    var date = new Date();

    var year = date.getFullYear();

    var month = date.getMonth() + 1;
    month = (month < 10 ? "0" : "") + month;

    var day  = date.getDate();
    day = (day < 10 ? "0" : "") + day;

    var hour = date.getHours();
    hour = (hour < 10 ? "0" : "") + hour;

    var minute = date.getMinutes();
    minute = (minute < 10 ? "0" : "") + minute;

	var second = date.getSeconds();
    second = (second < 10 ? "0" : "") + second;

    return year + "_" + month + "_" + day + "_" + hour + minute + second;

}

getNccuOjResult( problemId, process.argv[3], process.argv[4] );
