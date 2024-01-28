import fetch from 'node-fetch'
import cheerio from 'cheerio'
import fs from 'fs';

var time = new Date().getTime();

const seriesDirs = [
    ['The Original Series', 'TOS', 'StarTrek'], 
    ['The Next Generation', 'TNG', 'NextGen'], 
    ['Deep Space Nine', 'DS9', 'DS9'], 
    ['Voyager', 'VOY', 'Voyager', 'episode_listing.htm'], 
    ['Enterprise', 'ENT', 'Enterprise']
] // Sub-directories of series on the chakoteya.net website

// Arrays for different types of data grouping
var rawLines = [];
var linesByEpisode = {};
var linesByCharacter = {};

// Links for each episode
var hrefs = [];

console.log("First gathering links for all the scripts of each episode...")

for (var d of seriesDirs) {
    var [_, name, dir, file] = d
    var f = await fetch(`http://www.chakoteya.net/${dir}/${file || 'episodes.htm'}`) // Get data from chakoteya.net
    var data = await f.text();
    const $ = cheerio.load(data);
    $("table").each(function(index) {
        if (index) {
            var isTAS = name == 'TOS' && index == 4; //TAS is grouped with TOS on the site, this makes it separate
            var season = isTAS ? 1 : name == 'ENT' ? index - 1 : index;
            var episode = 1;
            $(this).find("a").each((_, link) => {
                var href = $(link).attr('href')
                if (href && !href.includes('/') && !href.includes("fortyseven")) {
                    hrefs.push([isTAS ? ['The Animated Series', 'TAS', 'StarTrek'] : d, [season, episode], href])
                    console.log(`Got link for ${isTAS ? 'TAS' : name} S${season}E${episode} - ${href}`)
                    episode++;
                }
            })
        }
    })
}

var warnings = [];

console.log("Got all links for all scripts! Now getting the lines...")

for (var [d, ep, href] of hrefs) {
    var [name, shortname, dir] = d;
    var [season, episode] = ep;
    console.log(`Collecting lines from ${shortname} S${season} E${episode}...`)
    var f = await (fetch(`http://www.chakoteya.net/${dir}/${href}`))
    var data = await f.text();
    const $ = cheerio.load(data);
    var lines = $("p, b").map(function() { 
        return $(this).html().replace(/(?:\r\n|\r|\n)/g, ' ').trim()
    }).toArray();
    
    lines.splice(lines.findIndex(x => x.includes('episodes.htm') || x.includes('episode_listing.htm')))

    lines = lines.flatMap(x => x.split("<br>").map(y => y.replace(/\{[^)]*\}/g, "").replace(/\{[^)]*\]/g, "").replace(/\[[^)]*\]/g, "").replace(/\([^)]*\)/g, "").trim())).filter(x => !x.startsWith('['))
    var ind = lines.findIndex(x => !x);
    if (ind == -1) {
        ind = lines.findIndex(x => x.startsWith("<b></b>"))
    }
    var episodeDetails = lines.splice(0, ind)

    lines.shift();
    lines = lines.filter(x => x.includes(":")).flatMap(x => {
        var arr = x.split(":")
        var name = arr.shift().split(" [")[0].split(" ").filter(x => x.toUpperCase() == x).join(" ").replace(/ *\([^)]*\) */g, "").replace(/[^A-Z +\-']/g, '').replace(/(<([^>]+)>)/gi, "").trim()
        var message = arr.join(":").replace(/ *\([^)]*\) */g, "").replace(/(<([^>]+)>)/gi, "").trim();
        if (name && name == name.toUpperCase()) {
            if (name.includes("+")) {
                var names = name.split("+").map(x => x.trim());
                return names.map(x => {return {author: x, message: message}})
            } else {
                return [{ author: name, message: message }]
            }
        }
    }).filter(x => x)

    var title = (episodeDetails.shift() ?? "Unknown Title").replace(/(<([^>]+)>)/gi, "");
    if (title == "Unknown Title") {
        warnings.push(`S${season} E${episode}`)
        console.log("YELLOW ALERT: Was unable to retrieve the title of this episode. Something may have gone wrong.")
    }

    var stardate, airdate;

    episodeDetails.forEach(x => {
        if (x.toLowerCase().includes('stardate')) {
            stardate = x.split(":")[1]
            try {
                stardate = parseFloat(stardate);
            } catch(e) {}
        } else if (x.toLowerCase().includes('airdate')) {
            airdate = new Date(x.split(":")[1]).toLocaleDateString();
        }
    })

    rawLines.push(...lines);

    if (!linesByEpisode[shortname]) linesByEpisode[shortname] = { name: name, short_name: shortname, episodes: [] }
    linesByEpisode[shortname].episodes.push({
        title: title,
        stardate: stardate,
        airdate: airdate,
        season: season,
        episode: episode,
        lines: lines
    })

    lines.forEach(line => {
        if (!linesByCharacter[line.author]) linesByCharacter[line.author] = [];
        linesByCharacter[line.author].push(line.message)
    })

    console.log(`Collected ${lines.length.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} lines from ${shortname} S${season}E${episode}! ("${title}")`)
}

console.log(`All done! Now adding ${rawLines.length.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} lines to JSON files...`)
fs.writeFileSync('data/raw_lines.json', JSON.stringify(rawLines))
fs.writeFileSync('data/lines_by_episode.json', JSON.stringify(linesByEpisode))
fs.writeFileSync('data/lines_by_character.json', JSON.stringify(linesByCharacter))

console.log(`Complete with ${warnings.length} warnings! (${((new Date().getTime() - time) / 1000)}s)`)
if (warnings.length) console.log("Warnings occurred on " + warnings.join(", "))
