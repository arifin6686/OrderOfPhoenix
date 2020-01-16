/**
* Managed Guild System by jd
* This code is far from perfect and if I was going to
* do it again I'd definitely do a lot differently.
*
* @license MIT license
*/

'use strict';

const fs = require('fs');
const Autolinker = require('autolinker');

let database = new sqlite3.Database('config/leagues.db', function () {
	database.run("CREATE TABLE IF NOT EXISTS points (date INTEGER, userid TEXT, league TEXT, points INTEGER, reason TEXT)");
});

let leagues = {};
try {
	leagues = JSON.parse(fs.readFileSync('config/leagues.json', 'utf8'));
} catch (e) {
	if (e.code !== 'ENOENT') throw e;
}

function save() {
	if (Object.keys(leagues).length < 1) return fs.writeFileSync('config/leagues.json', JSON.stringify(leagues));
	let data = "{\n";
	for (let u in leagues) {
		data += '\t"' + u + '": ' + JSON.stringify(leagues[u]) + ",\n";
	}
	data = data.substr(0, data.length - 2); // remove the last comma
	data += "\n}";
	fs.writeFileSync('config/leagues.json', data);
}

function logPoints(userid, amount, reason) {
	let leagueid = toId(getLeague(userid));
	let date = Date.now();
	userid = toId(userid);
	database.run("INSERT INTO points(date, userid, league, points, reason) VALUES ($date, $userid, $league, $points, $reason)",
		{$date: date, $userid: userid, $league: leagueid, $points: amount, $reason: reason},
		function (err) {
		    if (err) return console.log("league logPoints: " + err);
		});
}

function logPointsUser(user, league, amount, reason) {
	let leagueid = toId(league);
	let date = Date.now();
	database.run("INSERT INTO points(date, userid, league, points, reason) VALUES ($date, $userid, $league, $points, $reason)",
		{$date: date, $userid: "[" + user + "]", $league: leagueid, $points: amount, $reason: reason},
		function (err) {
		    if (err) return console.log("league logPointsUser: " + err);
		});
}

function log(message) {
	if (!message) return false;
	fs.appendFile('logs/leagues.log', '[' + new Date().toUTCString() + '] ' + message + '\n');
}

function leaguePM(message, league) {
	let leagueid = toId(league);
	if (!leagues[leagueid]) return;
	for (let u in leagues[leagueid].users) {
		if (!Users(leagues[leagueid].users[u]) || !Users(leagues[leagueid].users[u]).connected) continue;
		Users(leagues[leagueid].users[u]).send("|pm|~" + serverName + " Master|~|/raw " + message);
	}
}

function leagueLog(message, league) {
	let leagueid = toId(league);
	fs.appendFileSync('logs/leagues/' + leagueid + '.log', '[' + new Date().toUTCString() + '] ' + message + '\n');
}

function getLeague(user) {
	user = toId(user);
	let reply;
	for (let league in leagues) {
		if (leagues[league].users.includes(user)) {
			reply = leagues[league].name;
			break;
		}
	}
	return reply;
}
Server.getLeague = getLeague;

function getLeagueRank(user) {
	user = toId(user);
	let league = toId(getLeague(user));
	if (!leagues[league]) return false;
	if (!league) return false;
	for (let rank in leagues[league].ranks) {
		if (leagues[league].ranks[rank].users.includes(user)) return leagues[league].ranks[rank].title;
	}
}
Server.getLeagueRank = getLeagueRank;

function hasPermission(user, permission) {
	let league = leagues[toId(getLeague(user))];
	if (!league) return false;
	let rank = toId(getLeagueRank(user));
	if (league.ranks[rank].permissions['all']) return true;
	if (league.ranks[rank].permissions[permission]) return true;
	return false;
}

const permissionList = {
	all: true,
	invite: true,
	kick: true,
	desc: true,
	masspm: true,
	promote: true,
	manageranks: true,
	lvl: true,
	icon: true,
};

function leagueTourPoints(winner, runnerup, tourSize, room) {
	let winnerLeague = toId(getLeague(winner));
	let secondLeague = toId(getLeague(runnerup));
	let winnerPoints = Math.round(tourSize / 2);
	let secondPoints = Math.round(winnerPoints / 2);
	if (winnerLeague && winnerPoints > 0) {
		leagues[winnerLeague].points += winnerPoints;
		save();
		logPoints(winner, winnerPoints, "First place in a tournament in " + room.id);
		room.addRaw("<b>" + Server.nameColor(winner, true) + " has won " + winnerPoints + (winnerPoints === 1 ? " point " : " points ") + " for " + Chat.escapeHTML(leagues[winnerLeague].name) + "</b>");
	}
	if (secondLeague && secondPoints > 0) {
		leagues[secondLeague].points += secondPoints;
		save();
		logPoints(runnerup, secondPoints, "Second place in a tournament in " + room.id);
		room.addRaw("<b>" + Server.nameColor(runnerup, true) + " has won " + secondPoints + (secondPoints === 1 ? " point " : " points ") + " for " + Chat.escapeHTML(leagues[secondLeague].name) + "</b>");
	}
}
Server.leagueTourPoints = leagueTourPoints;

exports.commands = {
	guild: 'guilds',
	guilds: {
		create: function (target, room, user) {
			if (!this.can('eval')) return false;
			if (!target) return this.errorReply("Usage: /guild create [guild name], [user]");
			let targets = target.split(',');
			for (let u in targets) targets[u] = targets[u].trim();

			if (!targets[0]) return this.errorReply("Usage: /guild create [guild name], [user]");
			if (!targets[1]) return this.errorReply("Usage: /guild create [guild name], [user]");

			let leagueid = toId(targets[0]);
			let leagueName = targets[0];
			let targetUser = Users(targets[1]);

			if (leagueid.length < 1) return this.errorReply("Guild names must be at least one character long.");
			if (leagueid.length > 30 || leagueName.length > 30) return this.errorReply("Guild names may not be longer than 30 characters.");
			if (leagues[leagueid]) return this.errorReply("Guild already exists.");
			if (!targetUser || !targetUser.connected) return this.errorReply('"' + targets[1] + '" is not currently online.');

			leagues[leagueid] = {
				name: leagueName,
				id: leagueid,
				pendingInvites: [],
				points: 0,
				desc: "",
				icon: "",
				users: [targetUser.userid],
				ranks: {
					'grandmaster': {
						title: 'Grand Master',
						users: [targetUser.userid],
						permissions: {
							all: true,
						},
						sortBy: 100,
					},
					'masters': {
						title: 'Masters',
						users: [],
						permissions: {
							invite: true,
							kick: true,
							desc: true,
							masspm: true,
							promote: true,
							manageranks: true,
						},
						sortBy: 8,
					},
					'champions': {
						title: 'Champions',
						users: [],
						permissions: {
							lvl: true,
						},
						sortBy: 6,
					},
					'elite': {
						title: 'Elite',
						users: [],
						permissions: {
							givebadge: true,
						},
						sortBy: 4,
					},
					'commeners': {
						title: 'Commeners',
						users: [],
						permissions: {},
						sortBy: 2,
					},
				},
			};
			save();
			fs.writeFile('./logs/leagues/' + leagueid + '.log');
			log(user.name + " has created the guild '" + leagueName + "'.");
			this.sendReply("You've created the guild \"" + leagueName + "\".");
		},

		delete: function (target, room, user) {
			if (!this.can('eval')) return false;
			if (!target) return this.errorReply("Usage: /guild delete [guild name].");
			if (!leagues[toId(target)]) return this.errorReply("Guild does not exist.");

			delete leagues[toId(target)];
			save();
			log(user.name + " has deleted the guild '" + target + "'.");
			this.sendReply("You've deleted the guild '" + target + '".');
		},

		invite: function (target, room, user) {
			if (!target) return this.errorReply("Usage: /guild invite [user] - Invites a user to your league.");

			let leagueid = toId(getLeague(user.userid));
			let targetUser = Users(target);
			if (!leagues[leagueid]) return this.errorReply("You're not in a guild.");
			if (!targetUser || !targetUser.connected) return this.errorReply("That user is not currently online.");
			if (leagues[leagueid].users.includes(targetUser.userid)) return this.errorReply("That user is already in your guild.");
			if (leagues[leagueid].pendingInvites.includes(targetUser.userid)) return this.errorReply("There's already a pending invitation for that user to join your guild.");

			for (let league in leagues) {
				if (leagues[league].id === leagueid) continue;
				if (leagues[league].users.includes(targetUser.userid)) return this.errorReply("That user is a member of " + leagues[league].name + ".");
			}

			if (!hasPermission(user.userid, 'invite')) return this.errorReply("You don't have permission to invite users to " + target + ".");

			leagues[leagueid].pendingInvites.push(targetUser.userid);
			save();
			leagueLog(user.name + " has invited " + targetUser.name + " to join the guild.", leagueid);
			leaguePM(Server.nameColor(user.name, true) + " has invited " + Server.nameColor(targetUser.name, true) + " to join the guild.", leagueid);
			let message = "/html has invited you to join the league " + Chat.escapeHTML(leagues[leagueid].name) + ". <br />" +
				"<button name=\"send\" value=\"/guild accept " + leagueid + "\">Click to accept</button> | <button name=\"send\" value=\"/guild decline " + leagueid +
				"\">Click to decline</button>";
			targetUser.send("|pm|" + user.getIdentity() + "|" + targetUser.getIdentity() + "|" + message);
			this.sendReply("You've invited " + targetUser.name + " to join " + leagues[leagueid].name + ".");
		},

		accept: function (target, room, user) {
			if (!target) return this.errorReply("Usage: /guild accept [league]");
			let leagueid = toId(target);
			if (!leagues[leagueid]) return this.errorReply("That guild does not exist.");
			if (!leagues[leagueid].pendingInvites.includes(user.userid)) return this.errorReply("You don't have a pending invitation to this guild.");

			if (getLeague(user.userid)) return this.errorReply("You've already joined a guild.");

			let sortedRanks = Object.keys(leagues[leagueid].ranks).sort(function (a, b) { return leagues[leagueid].ranks[b].rank - leagues[leagueid].ranks[a].rank; });
			let rank = sortedRanks.pop();
			leagues[leagueid].users.push(user.userid);
			leagues[leagueid].ranks[rank].users.push(user.userid);
			leagues[leagueid].pendingInvites.splice(leagues[leagueid].pendingInvites.indexOf(user.userid), 1);
			save();
			leagueLog(user.name + " has accepted their invitation to join the guild.", leagueid);
			leaguePM(Server.nameColor(user.name, true) + " has accepted their invitation to join the guild.", leagueid);

			user.popup("You've accepted the invitation to join " + leagues[leagueid].name + ".");
		},

		decline: function (target, room, user) {
			if (!target) return this.errorReply("Usage: /guild decline [league]");
			let leagueid = toId(target);
			if (!leagues[leagueid]) return this.errorReply("That guild does not exist.");
			if (!leagues[leagueid].pendingInvites.includes(user.userid)) return this.errorReply("You don't have a pending invitation to this guild.");

			leagues[leagueid].pendingInvites.splice(leagues[leagueid].pendingInvites.indexOf(user.userid), 1);
			save();
			leagueLog(user.name + " has declined their invitation to join the guild.", leagueid);
			leaguePM(Server.ameColor(user.name, true) + " has declined their invitation to join the guild.", leagueid);
			user.popup("You've declined the invitation to join " + leagues[leagueid].name + ".");
		},

		kick: function (target, room, user) {
			if (!target) return this.errorReply("Usage: /guild kick [user] - Kicks a user to your guild.");

			let leagueName = getLeague(user.userid);
			let leagueid = toId(leagueName);
			let targetid = toId(target);
			if (!leagues[leagueid]) return this.errorReply("You're not in a guild.");
			if (!leagues[leagueid].users.includes(targetid)) return this.errorReply("That user is not in your guild.");

			if (!hasPermission(user.userid, 'kick')) return this.errorReply("You don't have permission to kick users from '" + leagueName + "'.");

			for (let rank in leagues[leagueid].ranks) {
				if (leagues[leagueid].ranks[rank].users.includes(targetid)) {
					leagues[leagueid].ranks[rank].users.splice(leagues[leagueid].ranks[rank].users.indexOf(targetid), 1);
				}
			}
			leagues[leagueid].users.splice(leagues[leagueid].users.indexOf(targetid), 1);
			save();
			leagueLog(user.name + " has kicked " + target + " from the guild.", leagueid);
			leaguePM(Server.nameColor(user.name, true) + " has kicked " + Server.nameColor(target, true) + " from the guild.", leagueid);

			if (Users(target) && Users(target).connected) Users(target).send("|popup||html|" + Server.nameColor(user.name, true) + " has kicked you from the guild " + Chat.escapeHTML(leagues[leagueid].name) + ".");
			this.sendReply("You've kicked " + target + " from " + leagues[leagueid].name + ".");
		},

		leave: function (target, room, user) {
			let leagueid = toId(getLeague(user.userid));
			if (!leagues[leagueid]) return this.errorReply("You're not in a guild.");
			if (leagues[leagueid].ranks['owner'].users.includes(user.userid)) return this.errorReply("You can't guild a guild if you're the owner.");

			for (let rank in leagues[leagueid].ranks) {
				if (!leagues[leagueid].ranks[rank].users.includes(user.userid)) continue;
				leagues[leagueid].ranks[rank].users.splice(leagues[leagueid].ranks[rank].users.indexOf(user.userid), 1);
			}
			leagues[leagueid].users.splice(leagues[leagueid].users.indexOf(user.userid), 1);
			save();
			leagueLog(user.name + " has left the guild.", leagueid);
			leaguePM(Server.nameColor(user.name, true) + " has left the guild.", leagueid);
			this.sendReply("You have left " + leagues[leagueid].name + ".");
		},

		icon: function (target, room, user) {
		    if (!target) return this.errorReply("Usage: /guild icon [link] - set your guild icon.");
		    let leagueid = toId(getLeague(user.userid));
		    if (!leagues[leagueid]) return this.errorReply("You're not in a guild.");
		    if (!hasPermission(user.userid, 'icon')) return this.errorReply("You don't hve permission to set the guild icon of '" + leagues[leagueid].name + "'.");
		    leagues[leagueid].icon = target;
		    save();
		    leagueLog(user.name + " has set the guild icon.");
		    leaguePM(user.name + " has set guild icon.");
		    this.sendReply("You've changed the guild icon.");
		},

		description: 'desc',
		desc: function (target, room, user) {
			if (!target) return this.errorReply("Usage: /guild desc [description] - Sets your guild description.");

			let leagueid = toId(getLeague(user.userid));
			if (!leagues[leagueid]) return this.errorReply("You're not in a guild.");
			if (target.length < 1) return this.errorReply("The guild description must be at least one character long.");
			if (target.length > 100) return this.errorReply("The guild description may not be longer than 100 characters.");

			if (!hasPermission(user.userid, 'desc')) return this.errorReply("You don't have permission to set the guild description of '" + leagues[leagueid].name + "'.");

			leagues[leagueid].desc = target;
			save();
			leagueLog(user.name + " has set the guild description to '" + target + "'.", leagueid);
			leaguePM(user.name + " has set the guild description to '" + Chat.escapeHTML(target) + "'.", leagueid);
			this.sendReply("You've changed the guild description.");
		},

		announce: 'pm',
		pm: function (target, room, user) {
			if (!target) return this.errorReply("Usage: /guild pm [message] - Sends a message to all guild members currently online.");

			let leagueid = toId(getLeague(user.userid));
			if (!leagues[leagueid]) return this.errorReply("You're not in a guild.");
			if (target.length < 1) return this.errorReply("The nessage must be at least one character long.");
			if (target.length > 500) return this.errorReply("The message may not be longer than 500 characters.");

			if (!hasPermission(user.userid, 'masspm')) return this.errorReply("You don't have permission to send a guild pm.");

			leagueLog(user.name + " has sent out a guild pm: " + target, leagueid);
			leaguePM("Guild announcement from " + Server.nameColor(user.name, true) + ":<br />" + Chat.escapeHTML(target), leagueid);
		},

		members: function (target, room, user) {
			if (!target) return this.errorReply("Please specify a guild to view the members of.");
			target = toId(target);
			if (!leagues[target]) return this.errorReply("That guild does not exist.");
			let output = Chat.escapeHTML(leagues[target].name) + " members:\n\n";
			let sortedRanks = Object.keys(leagues[target].ranks).sort(function (a, b) { return leagues[target].ranks[b].sortBy - leagues[target].ranks[a].sortBy; });

			for (let rank in sortedRanks) {
				let users = [];
				let curRank = sortedRanks[rank];
				output += Chat.escapeHTML(leagues[target].ranks[curRank].title) + " (" + leagues[target].ranks[curRank].users.length + "):\n";
				for (let u in leagues[target].ranks[curRank].users) {
					let curUser = leagues[target].ranks[curRank].users[u];
					users.push(Server.nameColor(curUser, (Users(curUser) && Users(curUser).connected)));
				}
				output += users.join(',');
				output += "\n\n";
			}
			user.send("|popup||wide||html|" + output);
		},

		ladder: 'list',
		list: function (target, room, user) {
		    if (!this.runBroadcast()) return;
			if (Object.keys(leagues).length < 1) return this.sendReply("There's no registered guild on this server.");
			let output = '<center><table style="border-collapse: collapse ; box-shadow: 0px 0px 2px #232423" width="100%"><tr><td class="gangth" style="box-shadow: 0px 0px 1px white inset">Guild</td><td class="gangth" style="box-shadow: 0px 0px 1px white inset">Description</td><td class="gangth" style="box-shadow: 0px 0px 1px white inset">Points</td><td class="gangth" style="box-shadow: 0px 0px 1px white inset">Members</td></tr>';
			let sortedLeagues = Object.keys(leagues).sort(function (a, b) {
				return leagues[b].points - leagues[a].points;
			});

			for (let league in sortedLeagues) {
				let curLeague = leagues[sortedLeagues[league]];
				let desc = Chat.escapeHTML(curLeague.desc);
				if (desc.length > 50) desc = desc.substr(0, 50) + "<br />" + desc.substr(50);
				output += '<tr>';
				output += '<td class="gangtd" style="box-shadow: 0px 0px 10px white inset"><img src="' + curLeague.icon + '" width="33px" height="33px"> ' + Chat.escapeHTML(curLeague.name) + '</td>';
				output += '<td class="gangtd" style="box-shadow: 0px 0px 1px white inset">' + Autolinker.link(desc.replace(/&#x2f;/g, '/'), {stripPrefix: false, phone: false, twitter: false}) + '</td>';
				output += '<td class="gangtd" style="box-shadow: 0px 0px 10px white inset">' + '<button name="send" class="gangbtn" value="/guild points log ' + curLeague.id + '">' + curLeague.points + '</button></td>';
				output += '<td class="gangtd" style="box-shadow: 0px 0px 10px white inset">' + '<button name="send" class="gangbtn" value="/guild members ' + curLeague.id + '">' + curLeague.users.length + '</button></td>';
				output += '</tr>';
			}
			output += '</table></center>';
			this.sendReply("|html|" + output);
		},

		ranks: 'rank',
		rank: {
			set: 'give',
			give: function (target, room, user) {
				if (!target) return this.errorReply("Usage: /guild rank give [user], [rank] - Gives a user a rank in your guild.");
				let targets = target.split(',');
				for (let u in targets) targets[u] = targets[u].trim();

				if (!targets[0]) return this.errorReply("Please specify a user to give a rank.");
				if (!targets[1]) return this.errorReply("Please specify a rank to give the user.");

				let leagueid = toId(getLeague(user.userid));
				let targetUser = Users.getExact(targets[0]);
				let rank = targets[1];

				if (!leagues[leagueid]) return this.errorReply("You're not in a guild.");
				if (!targetUser || !targetUser.connected) return this.errorReply("That user is not online.");
				if (!leagues[leagueid].users.includes(targetUser.userid)) return this.errorReply("That user is not in your guild.");
				if (!leagues[leagueid].ranks[toId(rank)]) return this.errorReply("That rank does not exist.");
				if (leagues[leagueid].ranks[toId(rank)].users.includes(targetUser.userid)) return this.errorReply("That user already has that rank.");

				if (!hasPermission(user.userid, 'promote')) return this.errorReply("You don't have permission to change users rank.");

				if (toId(rank) !== 'grandmaster') {
					for (let rank in leagues[leagueid].ranks) {
						if (rank === 'grandmaster') continue;
						if (leagues[leagueid].ranks[rank].users.includes(targetUser.userid)) {
							leagues[leagueid].ranks[rank].users.splice(leagues[leagueid].ranks[rank].users.indexOf(targetUser.userid), 1);
						}
					}
				}

				leagues[leagueid].ranks[toId(rank)].users.push(targetUser.userid);
				save();
				rank = leagues[leagueid].ranks[toId(rank)].title;
				leagueLog(user.name + " has set " + targetUser.name + "'s rank to " + rank, leagueid);
				leaguePM(Server.nameColor(user.name, true) + " has set " + Server.nameColor(targetUser.name, true) + "'s rank to " + Chat.escapeHTML(rank), leagueid);
				targetUser.send("|popup||html|" + Server.nameColor(user.name, true) + " has set your guild rank in " + Chat.escapeHTML(leagues[leagueid].name) + " to " +
				Chat.escapeHTML(rank) + ".");
				this.sendReply("You've set " + targetUser.name + "'s guild rank to " + rank + ".");
			},

			take: function (target, room, user) {
				if (!target) return this.errorReply("Usage: /guild rank take [user], [rank] - Takes a users rank in your guild.");
				let targets = target.split(',');
				for (let u in targets) targets[u] = targets[u].trim();

				if (!targets[0]) return this.errorReply("Please specify a user to remove a rank.");
				if (!targets[1]) return this.errorReply("Please specify a rank to remove from the user.");

				let leagueid = toId(getLeague(user.userid));
				let targetUser = targets[0];
				let rank = targets[1];

				if (!leagues[leagueid]) return this.errorReply("You're not in a guild.");
				if (!toId(targetUser) || toId(targetUser).length > 19) return this.errorReply("That's not a valid username.");
				if (!leagues[leagueid].users.includes(toId(targetUser))) return this.errorReply("That user is not in your guild.");
				if (!leagues[leagueid].ranks[toId(rank)]) return this.errorReply("That rank does not exist.");
				if (!leagues[leagueid].ranks[toId(rank)].users.includes(targetUser)) return this.errorReply("That user does not have that rank.");
				if (toId(rank) === 'grandmaster' && toId(targetUser) === user.userid) return this.errorReply("You can't remove owner from yourself. Give another user owner and have them remove it if you're transfering ownership of the guild.");

				if (!hasPermission(user.userid, 'promote')) return this.errorReply("You don't have permission to change users rank.");

				let hasOtherRanks;
				for (let r in leagues[leagueid].ranks) {
					if (r === toId(rank)) continue;
					if (leagues[leagueid].ranks[r].users.includes(targetUser)) {
						hasOtherRanks = true;
					}
				}
				if (!hasOtherRanks) return this.errorReply("That user has no other guild rank. Use '/guild kick " + targetUser + "' if you want to kick them from the guild.");
				leagues[leagueid].ranks[toId(rank)].users.splice(leagues[leagueid].ranks[toId(rank)].users.indexOf(toId(targetUser)), 1);
				save();
				leagueLog(user.name + " has removed the rank " + rank + " from " + targetUser, leagueid);
				leaguePM(Server.nameColor(user.name, true) + " has removed the rank " + Chat.escapeHTML(rank) + " from " + Server.nameColor(targetUser, true), leagueid);
				if (Users(targetUser) && Users(targetUser).connected) {
					Users(targetUser).send("|popup||html|" + Server.nameColor(user.name, true) + " has removed you from the guild rank " + Chat.escapeHTML(rank) + " in " +
					Chat.escapeHTML(leagues[leagueid].name) + ".");
				}
				this.sendReply("You've removed " + targetUser + " from the guild rank " + rank + ".");
			},

			create: function (target, room, user) {
				if (!target) return this.errorReply("Usage: /guild rank create [rank title], [sortby (a number)], [permissions seperated by comma] - See '/guild rank permissions' to learn valid permissions.");
				let targets = target.split(',');
				for (let u in targets) targets[u] = targets[u].trim();

				let leagueid = toId(getLeague(user.userid));
				let rank = targets[0];
				let sortBy = Number(targets[1]);
				let permissions = targets.splice(2);

				if (!leagues[leagueid]) return this.errorReply("You're not in a guild.");
				if (toId(rank).length < 1) return this.errorReply("Rank must be at least one character long.");
				if (rank.length > 30) return this.errorReply("Rank may not be longer than 30 characters.");
				if (leagues[leagueid].ranks[toId(rank)]) return this.errorReply("That rank already exists.");

				if (!sortBy) return this.errorReply("Please specify a number to determine where the rank appears on member list.");
				if (isNaN(sortBy)) return this.errorReply("sortby must be a number between 0 and 100. (higher sorts higher on the member list.)");

				for (let u in permissions) {
					if (!permissionList[permissions[u]]) {
						this.errorReply("The permission '" + permissions[u] + "' is not valid.");
						return this.parse("/guild rank permissions");
					}
				}

				if (!hasPermission(user.userid, 'manageranks')) return this.errorReply("You don't have permission to create guild ranks.");

				let permissionsObj = {};
				for (let u in permissions) permissionsObj[permissions[u]] = true;

				leagues[leagueid].ranks[toId(rank)] = {
					title: rank,
					users: [],
					permissions: permissionsObj,
					sortBy: sortBy,
				};
				save();
				leagueLog(user.name + " has added the rank '" + rank + "'.", leagueid);
				leaguePM(Server.nameColor(user.name, true) + " has added the rank '" + Chat.escapeHTML(rank) + "'.", leagueid);
				this.sendReply("You've added the rank '" + rank + "'.");
			},

			sortby: function (target, room, user) {
				if (!target) return this.errorReply("Usage: /guild rank sortby [rank], [number] - Edits the order this rank sorts in.");
				let leagueId = toId(getLeague(user.userid));
				if (!leagueId) return this.errorReply("You're not in a guild.");
				if (!hasPermission(user.userid, 'manageranks')) return this.errorReply("You don't have permission to edit guild ranks.");

				let targets = target.split(',');
				for (let u in targets) targets[u] = targets[u].trim();

				let rank = toId(targets[0]);
				let number = Number(targets[1]);

				if (isNaN(number) || number < 0 || number > 100) return this.errorReply("Please specify a valid number between 0 and 100");
				if (!leagues[leagueId].ranks[rank]) return this.errorReply("That rank does not exist.");

				leagues[leagueId].ranks[rank].sortBy = number;
				save();
				this.sendReply("You've edited the rank '" + rank + "'.");
			},

			delete: function (target, room, user) {
				if (!target) return this.errorReply("Usage: /guild rank delete [rank title]");

				let leagueid = toId(getLeague(user.userid));
				let rank = target;

				if (!leagues[leagueid]) return this.errorReply("You're not in a guild.");
				if (!leagues[leagueid].ranks[toId(rank)]) return this.errorReply("That rank does not exist.");
				if (leagues[leagueid].ranks[toId(rank)].users.length > 0) return this.errorReply("You can't delete a rank that still has users.");
				if (toId(rank) === 'grandmaster') return this.errorReply("The guild has to have an owner.");

				if (!hasPermission(user.userid, 'manageranks')) return this.errorReply("You don't have permission to delete guild ranks.");

				delete leagues[leagueid].ranks[toId(rank)];
				save();
				leagueLog(user.name + " has deleted the rank '" + rank + "'.", leagueid);
				leagueLog(Server.nameColor(user.name, true) + " has deleted the rank '" + Chat.escapeHTML(rank) + "'.", leagueid);
				this.sendReply("You've deleted the rank '" + rank + "'.");
			},

			permissions: function (target, room, user) {
				if (!this.runBroadcast()) return;
				this.sendReply('|raw|<div class="infobox infobox-limited">' +
					'Valid Permissions:<br />' +
					'"all": Gives the rank access to EVERY guild command.<br />' +
					'"invite": Gives the rank access to invite users to join the guild.<br />' +
					'"kick": Gives the rank access to kick members from the guild.<br />' +
					'"desc": Gives the rank access to set the guild description.<br />' +
					'"masspm": Gives the rank access to mass pm all guild members.<br />' +
					'"promote": Gives the rank access to promote guild members.<br />' +
					'"manageranks": Gives the rank access to create and delete ranks. NOTE: This is a dangerous permission.<br />' +
					'Example Usage: /guild rank create Professor, 3, givebadges - Creates a rank named "Professor", places it above Gym Leader, and gives it access to give badges.' +
					'</div>'
				);
			},

			'': 'help',
			help: function (target, room, user) {
				if (!this.runBroadcast()) return;
				this.sendReply("|raw|<div class=\"infobox infobox-limited\">" +
					"/guild rank create [rank title], [sortby (a number)], [permissions seperated by comma] - See <button style=\"background: none; border: none; color: blue\" name=\"send\" value=\"/guild rank permissions\"><u>/guild rank permissions</u></button> for a list of valid permissions.<br />" +
					"/guild rank delete [rank title] - Deletes a league rank. You have to remove the rank from members before deleting it.<br />" +
					"/guild rank sortby [rank], [number] - Changes how a rank sorts on the member list. 99 as a number for example would sort one below owner, 98 sorting below the rank with 99 and so on.<br />" +
					"/guild rank give [user], [rank] - Gives a rank to a user in your guild.<br />" +
					"/guild rank take [user], [rank] - Takes a rank from a user in your guild.<br />"
				);
			},
		},

		'point': 'points',
		points: {
			give: function (target, room, user) {
				if (!this.can('eval')) return false;
				if (!target) return this.errorReply("Usage: /guild points give [guild], [points]");
				let targets = target.split(',');
				for (let u in targets) targets[u] = targets[u].trim();
				if (!targets[1]) return this.errorReply("Usage: /guild points give [guild], [points]");

				let league = toId(targets[0]);
				let amount = Math.round(Number(targets[1]));

				if (!leagues[league]) return this.errorReply("That guild does not exist.");
				if (isNaN(amount) || amount < 1 || amount > 500) return this.errorReply("Amount must be a valid number between 1 and 500.");

				leagues[league].points += amount;
				save();
				logPointsUser("ADMIN", league, amount, "Points given by " + user.name);
				this.sendReply("You've given " + leagues[league].name + " " + amount + (amount === 1 ? " point." : " points."));
				leaguePM(Server.nameColor(user.name, true) + " has given your guild " + amount + (amount === 1 ? " point." : " points."), league);
			},

			take: function (target, room, user) {
				if (!this.can('eval')) return false;
				if (!target) return this.errorReply("Usage: /guild points take [guild], [points]");
				let targets = target.split(',');
				for (let u in targets) targets[u] = targets[u].trim();
				if (!targets[1]) return this.errorReply("Usage: /guild points take [guild], [points]");

				let league = toId(targets[0]);
				let amount = Math.round(Number(targets[1]));

				if (!leagues[league]) return this.errorReply("That guild does not exist.");
				if (isNaN(amount) || amount < 1 || amount > 500) return this.errorReply("Amount must be a valid number between 1 and 500.");

				leagues[league].points -= amount;
				save();
				logPointsUser("ADMIN", league, -amount, "Points taken by " + user.name);
				this.sendReply("You've taken " + amount + (amount === 1 ? " point " : " points ") + " from " + leagues[league].name + ".");
				leaguePM(Server.nameColor(user.name, true) + " has taken " + amount + (amount === 1 ? " point " : " points ") + " from your guild.", league);
			},

			reset: function (target, room, user) {
				if (!this.can('eval')) return false;
				if (!user.confirmLeaguePointsReset) {
					this.errorReply("WARNING: THIS WILL RESET ALL guild POINTS");
					this.errorReply("Run this command again if you are sure this is what you want to do.");
					user.confirmLeaguePointsReset = true;
					return;
				}

				this.logModCommand(user.name + " has reset all guild points.");
				Server.messageSeniorStaff("/html " + Server.nameColor(user.name, true) + " has reset all guild points.");
				Rooms('staff').add("|raw|" + Server.nameColor(user.name, true) + " has reset all guild points.").update();
				delete user.confirmLeaguePointsReset;
				for (let u in leagues) leagues[u].points = 0;
				save();
				database.run("DELETE FROM points;");
			},

			userlog: 'log',
			log: function (target, room, user, connection, cmd) {
				let leagueid = '';
				let targetUser = '';
				let searchObj;
				if (cmd === 'log') {
					leagueid = (target ? toId(target) : toId(getLeague(user.userid)));
					if (!leagueid && !target) return this.errorReply("Please specify a guild to view the points log.");
					if (!leagues[leagueid]) return this.errorReply("That guild does not exist.");
					searchObj = {$leagueid: leagueid};
				} else {
					if (!target) return this.errorReply("Please specify a user to view the logs of.");
					targetUser = toId(target);
					if (targetUser.length < 1 || targetUser.length > 19) return this.errorReply("That's not a valid user to search for.");
					leagueid = toId(getLeague(targetUser));
					if (!leagueid) return this.errorReply("That user isn't in a guild.");
					searchObj = {$userid: targetUser};
				}

				database.all("SELECT * FROM points WHERE " + (cmd === 'userlog' ? "userid=$userid " : "league=$leagueid ") + "ORDER BY date DESC LIMIT 500", searchObj, (err, rows) => {
					if (err) return console.log("/guild points log: " + err);
					if (rows.length < 1) return user.popup("No guild point logs found for " + Chat.escapeHTML(leagues[leagueid].name));

					let output = '<center>Displaying last 500 entries in guild points log for ' + Chat.escapeHTML(leagues[leagueid].name) + '<br /><br />';
					output += '<table border="1" cellspacing="0" cellpadding="5"><tr><th>User</th><th>Date</th><th>Reason</th><th>Points</th></tr>';

					for (let u in rows) {
						output += '<tr>';
						output += '<td>' + Server.nameColor(rows[u].userid, (Users(rows[u].userid) && Users(rows[u].userid).connected)) + '</td>';
						output += '<td>' + new Date(rows[u].date).toUTCString() + '</td>';
						output += '<td>' + Chat.escapeHTML(rows[u].reason) + '</td>';
						output += '<td>' + rows[u].points + '</td>';
						output += '</tr>';
					}

					output += '</table></center>';
					user.popup('|wide||html|' + output);
				});
			},

			'': 'help',
			help: function (target, room, user) {
				if (!this.runBroadcast()) return;
				this.sendReply("|raw|<div class=\"infobox infobox-limited\">" +
					"Guild Points Commands:<br />" +
					"/guild points give [guild], [amount] - Gives a guild points.<br />" +
					"/guild points take [guild], [amount] - Takes points from a guild.<br />" +
					"/guild points log [guild] - Displays the last 500 entries in the points log for a guild.<br />" +
					"/guild points userlog [user] - Displays the last 500 points a user has earned.<br />" +
					"/guild points reset - Resets every guild points back to 0." +
					"</div>"
				);
			},
		},

		'': 'help',
		help: function (target, room, user) {
			if (!this.runBroadcast()) return;
			return this.sendReply(
				"|raw|<div class=\"infobox\">" +
				"Managed Guild System:<br />" +
				"Admin Commands:<br />" +
				"/guild create [guild name], [guild owner] - Creates a guild.<br />" +
				"/guild delete [guild name] - Deletes a guild.<br /><br />" +
				"Guild Commands:<br />" +
				"/guild invite [user] - Invites a user to join a guild.<br />" +
				"/guild kick [user] - Kicks a user from a guild.<br />" +
				"/guild desc [description] - Sets a description for your guild, visible on /guild list.<br />" +
				"/guild pm [message] - Mass PM's a message to all online guild members<br />" +
				"/guild accept [guild name] - Accepts an invitation to join a guild.<br />" +
				"/guild decline [guild name] - Declines an invitation to join a guild.<br />" +
				"/guild leave - Leaves your current guild.<br />" +
				"/guild list - Displays a list of guild.<br />" +
				"/guild members [guild name] - Displays the memberlist for a guild.<br /><br />" +
				"guild Rank Commands:<br />" +
				"/guild rank give [user], [rank] - Gives a user a rank.<br />" +
				"/guild rank take [user], [rank] - Removes a rank from a user.<br />" +
				"/guild rank create [rank name], [sortby (a number for sorting this rank on /guild [members], [permissions seperated by comma] - Creates a new guild rank. See '/guild rank permissions' to learn about valid permissions.<br />" +
				"/guild rank delete [rank name] - Deletes a guild rank. Note: you can't delete a rank if any users currently have the rank.<br /><br />" +
				"Guild Points:<br />" +
				"/guild points give [guild], [amount] - Gives a guild points.<br />" +
				"/guild points take [guild], [amount] - Takes points from a guild.<br />" +
				"/guild points log [guild] - Displays the last 500 entries in the points log for a guild.<br />" +
				"/guild points userlog [user] - Displays the last 500 points a user has earned." +
				"</div>"
			);
		},
	},
	leaguehelp: function (target, room, user) {
		return this.parse('/guild help');
	},
};
