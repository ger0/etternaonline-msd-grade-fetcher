// ==UserScript==
// @name         Etterna Score Analyzer
// @namespace    http://tampermonkey.net/
// @version      1.1.4
// @description  Fetch and calculate MSD from "AAA" rank scores
// @require      https://cdnjs.cloudflare.com/ajax/libs/mathjs/11.11.0/math.min.js
// @author       gero, lyko
// @match        https://etternaonline.com/*
// @grant        none
// @run-at document-start
// ==/UserScript==
//
// javascript sucks, sorry I don't know this language well

let version = '1.1.4';

const Grade = {
    A:          80.0,
    AA:         93.0,
    AAA:        99.7,
    AAAA:       99.955,
    AAAAA:      99.9935
};

const DIV_SHOW_NAME_AAA = "AAA_MSD";
const DIV_SHOW_NAME_AAAA = "AAAA_MSD";

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// not sure if it's necessary to do it this way
function get_grade(obj, value) {
    for (const [key, val] of Object.entries(obj)) {
        if (val === value) {
            return key;
        }
    }
    return null;
}

// helper function to extract username from the URL / href link
function get_link_username(path) {
    const split = path.split('/').filter(segment => segment.length > 0);
    if (split.length != 2) {
        console.error("Failed to detect username, wrong page!");
        return null;
    } else if (split[0] !== 'users') {
        return null;
    }
    const raw_username = split[1];
    return username = raw_username.split(/[#?\/]/)[0];
}


async function display_overall(data, username, grade) {
    if (username != get_link_username(window.location.pathname)) {
        return;
    }
    console.log(`Calculated overall MSD: ${data.overall.toFixed(2)} for rank ${get_grade(Grade, data.target_rank)}`);
    console.log("Filtered scores:", data.list);
    const rank_body = document.getElementById(`${grade}_MSD`);
    if (rank_body) {
        if (data.overall <= 0.02) {
            rank_body.textContent = `No ${grade}s!`;
            return;
        }
        rank_body.textContent = `${grade} MSD Overall: ${data.overall.toFixed(2)}`;
    }
}

// source: https://github.com/etternagame/etterna/blob/master/src/Etterna/MinaCalc/MinaCalcHelpers.h#L35
function aggregate_scores (
    score_list,
    delta_mul,
    result_mul,
    rating,
    resolution
) {
    for (let i = 0; i < 11; i++) {
        let sum;
        if (!Array.isArray(score_list)) {
            console.error("score_list must be an array");
            throw new Error("score_list must be an array");
        }
        do {
            rating += resolution;
            sum = 0.0;

            score_list.forEach(it => {
                sum += Math.max(0.0, 2.0 / (1 - math.erf(delta_mul * (it - rating))) - 2);
            })
        } while (Math.pow(2, rating * 0.1) < sum);
        rating -= resolution;
        resolution /= 2.0;
    }
    rating += resolution * 2.0;
    return rating * result_mul;
}

async function fetch_page(username, curr_page, bearer) {
    return fetch(`https://api.etternaonline.com/api/users/${username}/scores?page=${curr_page}`
        + `&limit=200&sort=-datetime&filter[valid]=1`, {
        method: "GET",
        headers: {
            "Authorization": `${bearer}`,
            "Accept": "application/json"
        }
    });
}

async function fetch_scores(username) {
    const bearer = localStorage.getItem('auth._token.local');
    if (!bearer) {
        console.error("Token not found! Make sure you are logged in...");
        return;
    }
    let list = [];
    let curr_page = 1;
    let max_pages = 1;

    while (curr_page <= max_pages) try {
        let retryTime = 5000;
        let maxRetries = 5;
        let response;

        for (let retryCount = 0; retryCount <= maxRetries; retryCount++) {
            response = await fetch_page(username, curr_page, bearer);

            if (response.ok) {
                break;
            }
            console.error(response);
            console.error(`Attempt ${retryCount + 1}: Something went wrong with EO connection, status: ${response.status}. Retrying in ${retryTime/1000} seconds.`);
            await sleep(retryTime);

            retryTime += 5000;

            if (retryCount === maxRetries - 1) {
                throw new Error("Retry count exceeded, giving up.");
            }
        }

        const json = await response.json();
        const data = json.data || [];
        data.forEach(it => {
            if (it.wife >= Grade.AAA && it.valid === true) {
                const name = it.song.name;
                const overall = it.overall;
                const stream = it.stream;
                const jumpstream = it.jumpstream;
                const handstream = it.handstream;
                const jacks = it.jacks;
                const chordjacks = it.chordjacks;
                const stamina = it.stamina;
                const technical = it.technical;
                const wife = it.wife;
                const rate = it.rate;
                const datetime = it.datetime;
                // TODO: actually make most of those variables useful
                list.push({name, overall, stream, jumpstream, handstream, jacks, chordjacks, stamina, technical, wife, rate, datetime});
            }
        });
        const total_pages = json.meta.last_page || null;
        if (!total_pages) {
            break;
        }
        max_pages = total_pages;

        // sanity check
        if (get_link_username(window.location.pathname) !== username) {
            console.log(`cancelling score fetching for: ${username}`);
            return;
        }

        console.log(`Fetched page: ${curr_page} / ${max_pages} from player's scores`);
        let progress = document.getElementById(DIV_SHOW_NAME_AAA);
        progress.textContent = `Score fetching ${(curr_page * 100.0 / max_pages).toFixed(0)}%`;
        curr_page++;

        // rate limit
        sleep(200);
    } catch (error) {
        console.error("Failed to fetch scores:", error);
        break;
    }
    return list;
}

async function process_list(list, target_rank) {
    //sanity check
    if (!Array.isArray(list)) {
        console.log('code sucks');
    };
    list.sort((a, b) => b.overall - a.overall);
    list.length = Math.min(list.length, 250);
    const overall = aggregate_scores(
        list.map(it => it.overall),
        0.1,
        1.05,
        0.0,
        10.24
    );
    await display_overall({ overall, target_rank, list }, username, get_grade(Grade, target_rank));
    // Save to local storage
    localStorage.setItem(`etterna_${get_grade(Grade, target_rank)}_overall_${username}`, JSON.stringify({
        version: version,
        overall: overall,
        list: list
    }));
}

async function filter_list(list, target_rank) {
    let filtered_list = [];

    list.forEach(it => {
        if (it.wife >= target_rank) {
            filtered_list.push(it);
        }
    });

    return filtered_list;
}

async function run(link = null) {
    const target_rank = Grade.AAA;
    const path = link == null   ? window.location.pathname
                                : link;
    const username = get_link_username(path);
    if (!username) { return; }
    console.log(`Detected username: ${username}`);

    const card_body = document.querySelector('.rank');
    if (!card_body) {
        const div = document.createElement("div");
        document.classList.add("rank");
        card_body = div;
    }
    if (card_body && !document.getElementById(DIV_SHOW_NAME_AAA) && !document.getElementById(DIV_SHOW_NAME_AAAA)) {
        card_body.style.display = 'grid';
        card_body.style.placeItems = 'center';

        const AAA_MSD = document.createElement('div');
        AAA_MSD.id = DIV_SHOW_NAME_AAA;
        AAA_MSD.style.marginTop = '1em';
        AAA_MSD.style.fontWeight = 'bold';
        AAA_MSD.textContent = '';

        const AAAA_MSD = document.createElement('div');
        AAAA_MSD.id = DIV_SHOW_NAME_AAAA;
        AAAA_MSD.style.fontWeight = 'bold';
        AAAA_MSD.textContent = '';

        const button = document.createElement('button');
        button.textContent = 'Fetch Rank MSD';
        button.classList.add("btn");
        button.classList.add("btn-success");
        button.style.marginTop = '1em';
        button.data = "button";
        button.onclick = async function() {
            button.style.display="none";
            AAA_MSD.textContent = "Score fetching 0%"

            const list = await fetch_scores(username, target_rank);

            const aaa_list = await filter_list(list, Grade.AAA);
            const aaaa_list = await filter_list(list, Grade.AAAA);

            await process_list(aaa_list, Grade.AAA);
            await process_list(aaaa_list, Grade.AAAA);
        };

        card_body.appendChild(button);
        card_body.appendChild(AAA_MSD);
        card_body.appendChild(AAAA_MSD);
    }

    let has_cached = false;
    const last_fetch_aaa = localStorage.getItem(`etterna_AAA_overall_${username}`);
    const last_fetch_aaaa = localStorage.getItem(`etterna_AAAA_overall_${username}`);
    let saved_aaa;
    let saved_aaaa;
    if (last_fetch_aaa && last_fetch_aaaa) {
        saved_aaa = JSON.parse(last_fetch_aaa);
        saved_aaaa = JSON.parse(last_fetch_aaaa);
        console.log('ladies and gentlemen we got him');
        if (!saved_aaa && !saved_aaaa) {
            throw new Error("Failed to parse saved data from local storage!");
        }
        if (saved_aaa.version === version && saved_aaaa.version === version) {
            has_cached = true;
        }
    }
    if (has_cached) {
        console.log("Using cached data from local storage...")
        display_overall({ overall: saved_aaa.overall, target_rank: target_rank, list: saved_aaa.list }, username, 'AAA');
        display_overall({ overall: saved_aaaa.overall, target_rank: target_rank, list: saved_aaaa.list }, username, 'AAAA');
        return;
    }
}

(async function() {
    'use strict';

    // Click interception
    document.addEventListener('click', async(event) => {
        const link = event.target.closest('a');
        if (link && link.href) {
            const path = link.getAttribute('href');
            await sleep(2000); // yeah yeah
            run(path);
        }
    }, true);

    // History state change interception
    const history = (type) => {
        const original = history[type];
        return async function() {
            const result = original.apply(this, arguments);
            run();
            return result;
        };
    };

    history.pushState = history('pushState');
    history.replaceState = history('replaceState');

    // Back/Forward buttons interception
    window.addEventListener('popstate', async () => {
        await sleep(2000);
        run();
    });
    document.addEventListener("DOMContentLoaded", function() {
        run();
    });
})();
