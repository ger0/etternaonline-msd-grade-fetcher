// ==UserScript==
// @name         Etterna Score Analyzer
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Fetch and calculate MSD from "AAA" rank scores
// @require      https://cdnjs.cloudflare.com/ajax/libs/mathjs/11.11.0/math.min.js
// @author       gero
// @match        https://etternaonline.com/*
// @grant        none
// ==/UserScript==
// javascript sucks, sorry I don't know this language well

let version = '1.1';
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function display_overall(data) {
    console.log(`Calculated overall MSD: ${data.overall.toFixed(2)} for rank ${data.target_rank}`);
    console.log("Filtered scores:", data.list);
    const aaa_body = document.querySelector('.AAAMSD');
    if (aaa_body) {
        aaa_body.textContent = `AAA MSD Overall: ${data.overall.toFixed(2)}`;
    }
}

// source: https://github.com/etternagame/etterna/blob/master/src/Etterna/MinaCalc/MinaCalcHelpers.h#L35
function aggregate_scores (
    score_list = [], 
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
    return fetch(`https://api.etternaonline.com/api/users/${username}/scores?page=${curr_page}`, {
        method: "GET",
        headers: {
            "Authorization": `${bearer}`,
            "Accept": "application/json"
        }
    });
}

async function fetch_scores(username, target_rank) {
    const bearer = localStorage.getItem('auth._token.local');
    if (!bearer) { 
        console.error("Token not found! Make sure you are logged in...");
        return;
    }
    let list = [];
    // let avg = 0.0;
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
            } else {
                console.error(response);
                console.error(`Attempt ${retryCount + 1}: Something went wrong with EO connection, status: ${response.status}. Retrying in ${retryTime/1000} seconds.`);
                await sleep(retryTime);

                retryTime += 5000;
            }

            if (retryCount === maxRetries - 1) {
                throw new Error("Retry count exceeded, giving up.");
            }
        }

        const json = await response.json();
        const data = json.data || [];
        data.forEach(it => {
            if (it.grade === target_rank) {
                const name = it.song.name;
                const overall = it.overall;
                
                list.push({ name, overall });
            }
        });
        const total_pages = json.meta.last_page || null; 
        if (!total_pages) {
            break;
        }
        max_pages = total_pages;
        console.log(`Fetched page: ${curr_page} / ${max_pages} from player's scores`);
        curr_page++;
        // rate limit 
        sleep(200);
    } catch (error) {
        console.error("Failed to fetch schores:", error);
        break;
    }
    list.sort((a, b) => b.overall - a.overall);
    list.length = Math.min(list.length, 250);
    const overall = aggregate_scores(
        list.map(it => it.overall),
        0.1,
        1.05,
        0.0,
        10.24
    );
    display_overall({ overall, target_rank, list });
    // Save to local storage
    localStorage.setItem(`etterna_aaa_overall_${username}`, JSON.stringify({
        version: version,
        overall: overall,
        list: list
    }));
}

(async function() {
    'use strict';

    const target_rank = "AAA";
    const path = window.location.pathname;
    const split = path.split('/').filter(segment => segment.length > 0);
    if (split.length < 1) {
        console.error("Failed to detect username!");
        return;
    }
    const raw_username = split[1];
    const username = raw_username.split(/[#?\/]/)[0];
    console.log(`Detected username: ${username}`);

    const card_body = document.querySelector('.rank');
    if (card_body) {
        card_body.style.display = 'grid';
        card_body.style.placeItems = 'center';

        const button = document.createElement('button');
        button.textContent = 'Fetch AAA Overall MSD';
        button.style.marginTop = '1em';
        button.onclick = function() {
            fetch_scores(username, target_rank);
        };
        card_body.appendChild(button);

        const AAAMSD = document.createElement('div');
        AAAMSD.classList.add('AAAMSD');
        AAAMSD.style.marginTop = '1em';
        AAAMSD.style.fontWeight = 'bold';
        AAAMSD.textContent = '';
        card_body.appendChild(AAAMSD);
    }

    let should_calc = true;
    const last_fetch = localStorage.getItem(`etterna_aaa_overall_${username}`); 
    let saved = null;
    if (last_fetch) {
        saved = JSON.parse(last_fetch);
        if (!saved) {
            throw new Error("Failed to parse saved data from local storage!");
        }
        if (saved.version === version) {
            should_calc = false;
        }
    }
    if (!should_calc) {
        console.log("Using cached data from local storage...")
        display_overall({ overall: saved.overall, target_rank: target_rank, list: saved.list });
        return;
    }
    await fetch_scores(username, target_rank);
})();
