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

(async function() {
    'use strict';

    // Configuration
    const bearer = localStorage.getItem('auth._token.local');
    if (!bearer) { 
        console.error("Token not found! Make sure you are logged in...");
        return;
    }
    const path = window.location.pathname;
    const split = path.split('/').filter(segment => segment.length > 0);
    if (split.length < 1) {
        console.error("Failed to detect username!");
        return;
    }
    const raw_username = split[1];
    const username = raw_username.split(/[#?\/]/)[0];
    console.log(`Detected username: ${username}`);
    const target_rank = "A";

    async function fetch_scores() {
        let list = [];
        // let avg = 0.0;
        let curr_page = 1;
        let max_pages = 1;

        while (curr_page <= max_pages && curr_page < 5) try {
            const response = await fetch(`https://api.etternaonline.com/api/users/${username}/scores?page=${curr_page}`, {
                method: "GET",
                headers: {
                    "Authorization": `${bearer}`,
                    "Accept": "application/json"
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
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
        console.log(`Calculated overall MSD: ${overall.toFixed(2)} for rank ${target_rank}`);
        console.log("Filtered scores:", list);
    }

    // Run the function
    fetch_scores();

})();
