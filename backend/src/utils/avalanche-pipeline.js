const { DEFAULT_FETCH_HEADERS } = require('./http-client');
const {
  firstNonEmptyString,
  parseAvalancheDetailPayloads,
  normalizeAvalancheProblemCollection,
  getAvalancheProblemsFromDetail,
  pickBestAvalancheDetailCandidate,
  inferAvalancheExpiresTime,
  buildUtahForecastJsonUrl,
  extractUtahAvalancheAdvisory,
} = require('./avalanche-detail');
const {
  AVALANCHE_LEVEL_LABELS,
  AVALANCHE_OFF_SEASON_MESSAGE,
  createUnknownAvalancheData,
  cleanForecastText,
  pickBestBottomLine,
  normalizeExternalLink,
  resolveAvalancheCenterLink,
  applyDerivedOverallAvalancheDanger,
} = require('./avalanche-orchestration');
const { findMatchingAvalancheZone } = require('./geo');
const { parseIsoTimeToMs, parseIsoTimeToMsWithReference } = require('./time');
const { logger } = require('./logger');

/**
 * Fetches and assembles avalanche data from the map layer, detail APIs, and scraper fallbacks.
 * Returns the complete avalancheData object for the safety pipeline.
 */
async function fetchAvalanchePipeline({
  avyMapLayerPromise,
  parsedLat,
  parsedLon,
  fetchOptions,
  fetchWithTimeout,
  avyLog,
}) {
  let avalancheData = createUnknownAvalancheData('no_center_coverage');

  try {
    const avyJson = await avyMapLayerPromise;
    if (avyJson?.features) {
      const zoneMatch = findMatchingAvalancheZone(avyJson.features, parsedLat, parsedLon);
      const matchingZone = zoneMatch.feature;

      if (matchingZone) {
        if (zoneMatch.mode === 'nearest') {
          avyLog(
            `[Avy] No direct polygon match for ${parsedLat},${parsedLon}; using nearest zone fallback ` +
              `at ${Math.round(Number(zoneMatch.fallbackDistanceKm || 0))} km.`,
          );
        }
        const props = matchingZone.properties;
        const zoneId = matchingZone.id;
        const levelMap = AVALANCHE_LEVEL_LABELS;
        const mainLvl = parseInt(props.danger_level) || 0;
        const reportedRisk = String(props.danger || '').trim();
        const normalizedRisk = reportedRisk.toLowerCase();
        const travelAdviceText = String(props.travel_advice || '');
        const normalizedTravelAdvice = travelAdviceText.toLowerCase();
        const offSeasonFlag = props.off_season === true;
        const hasIssuedWindow = Boolean(props.start_date || props.end_date);
        const hasNoForecastLanguage =
          /no (current )?avalanche forecast|outside (the )?forecast season|not issuing forecasts|forecast season has ended|off[- ]?season/.test(
            `${normalizedRisk} ${normalizedTravelAdvice}`,
          );
        const hasRatedDangerWord = /low|moderate|considerable|high|extreme/.test(normalizedRisk);
        const noRatingForecast = mainLvl <= 0 && !hasRatedDangerWord;
        const centerNoActiveForecast =
          offSeasonFlag || hasNoForecastLanguage || (!hasIssuedWindow && noRatingForecast);

        avalancheData = {
          center: props.center,
          center_id: props.center_id,
          zone: props.name,
          risk: centerNoActiveForecast ? 'Unknown' : reportedRisk || 'No Rating',
          dangerLevel: centerNoActiveForecast || noRatingForecast ? 0 : mainLvl,
          dangerUnknown: centerNoActiveForecast || noRatingForecast,
          relevant: true,
          relevanceReason: null,
          coverageStatus: centerNoActiveForecast ? 'no_active_forecast' : 'reported',
          link: resolveAvalancheCenterLink({
            centerId: props.center_id,
            link: props.link,
            centerLink: props.center_link,
            lat: parsedLat,
            lon: parsedLon,
          }),
          bottomLine: centerNoActiveForecast
            ? cleanForecastText(travelAdviceText) || AVALANCHE_OFF_SEASON_MESSAGE
            : props.travel_advice,
          problems: [],
          publishedTime: centerNoActiveForecast
            ? null
            : props.start_date || props.published_time || null,
          expiresTime: centerNoActiveForecast
            ? null
            : firstNonEmptyString(props.end_date, props.expires, props.expire_time),
          elevations:
            centerNoActiveForecast || noRatingForecast
              ? null
              : (() => {
                  const parseLevel = (val) => {
                    const n = parseInt(val);
                    return Number.isFinite(n) ? n : mainLvl;
                  };
                  const l = parseLevel(props.danger_low);
                  const m = parseLevel(props.danger_mid);
                  const u = parseLevel(props.danger_high);
                  return {
                    below: { level: l, label: levelMap[l] || 'Unknown' },
                    at: { level: m, label: levelMap[m] || 'Unknown' },
                    above: { level: u, label: levelMap[u] || 'Unknown' },
                  };
                })(),
        };

        // Try to get the real bottom line by product ID
        try {
          avalancheData = await enrichAvalancheFromDetail({
            avalancheData,
            props,
            zoneId,
            levelMap,
            parsedLat,
            parsedLon,
            fetchOptions,
            fetchWithTimeout,
            avyLog,
          });
        } catch (e) {
          avyLog('[Avy] Error:', e.message);
        }

        // Scraper Fallback for Detail
        avalancheData = await tryScraperFallback({
          avalancheData,
          props,
          centerNoActiveForecast,
          fetchWithTimeout,
          avyLog,
        });

        if (centerNoActiveForecast) {
          const offSeasonFallback = createUnknownAvalancheData('no_active_forecast');
          avalancheData = {
            ...offSeasonFallback,
            center: props.center || offSeasonFallback.center,
            center_id: props.center_id || null,
            zone: props.name || null,
            link: resolveAvalancheCenterLink({
              centerId: props.center_id,
              link: props.link,
              centerLink: props.center_link,
              lat: parsedLat,
              lon: parsedLon,
            }),
            bottomLine:
              cleanForecastText(travelAdviceText) || offSeasonFallback.bottomLine,
          };
        }
      }
    }
  } catch (e) {
    logger.error({ err: e }, 'Avalanche API error');
    if (avalancheData.dangerUnknown) {
      avalancheData = createUnknownAvalancheData('temporarily_unavailable');
    }
  }

  return avalancheData;
}

/**
 * Enriches avalanche data by fetching detail payloads from avalanche.org API endpoints.
 */
async function enrichAvalancheFromDetail({
  avalancheData,
  props,
  zoneId,
  levelMap,
  parsedLat,
  parsedLon,
  fetchOptions,
  fetchWithTimeout,
  avyLog,
}) {
  avyLog(`[Avy] Zone: ${props.name}, ID: ${zoneId}, Center: ${props.center_id}`);
  let detailDet = null;
  let detailProblems = [];
  const normalizedLink = normalizeExternalLink(props.link);
  const zoneSlugRaw =
    normalizedLink?.split('#/')[1] || normalizedLink?.split('/').filter(Boolean).pop();
  const zoneSlug = zoneSlugRaw
    ? String(zoneSlugRaw).trim().replace(/^\/+|\/+$/g, '')
    : null;
  const detailAttempts = [];

  if (props.center_id && zoneId) {
    detailAttempts.push({
      label: 'center forecast query',
      url: `https://api.avalanche.org/v2/public/product?type=forecast&center_id=${props.center_id}&zone_id=${zoneId}`,
    });
  }
  if (zoneId) {
    detailAttempts.push({
      label: 'product id query',
      url: `https://api.avalanche.org/v2/public/product/${zoneId}`,
    });
  }
  if (props.center_id && zoneSlug) {
    detailAttempts.push({
      label: 'slug forecast query',
      url: `https://api.avalanche.org/v2/public/product?type=forecast&center_id=${props.center_id}&zone_id=${encodeURIComponent(zoneSlug)}`,
    });
  }

  const detailSettled = await Promise.allSettled(
    detailAttempts.map(async (attempt) => {
      avyLog(`[Avy] Trying ${attempt.label}: ${attempt.url}`);
      const candidateRes = await fetchWithTimeout(attempt.url, fetchOptions);
      if (!candidateRes.ok) throw new Error(`${attempt.label} HTTP ${candidateRes.status}`);
      const candidateText = await candidateRes.text();
      const candidatePayloads = parseAvalancheDetailPayloads(candidateText);
      if (!candidatePayloads.length) throw new Error(`${attempt.label} non-JSON payload`);
      const bestCandidate = pickBestAvalancheDetailCandidate({
        payloads: candidatePayloads,
        centerId: props.center_id,
        zoneId,
        zoneSlug,
        zoneName: props.name,
        cleanForecastText,
      });
      if (!bestCandidate) throw new Error(`${attempt.label} shell data`);
      return { attempt, ...bestCandidate };
    }),
  );
  const detailWinners = detailSettled
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value)
    .sort((a, b) => b.score - a.score);
  if (detailWinners.length) {
    const winner = detailWinners[0];
    detailDet = winner.candidate;
    detailProblems = winner.problems;
    avyLog(
      `[Avy] Using ${winner.attempt.label} for ${props.center_id} ` +
        `(parallel winner, score ${winner.score}, problems ${detailProblems.length}).`,
    );
  } else {
    detailSettled.forEach((r, i) => {
      if (r.status === 'rejected') {
        avyLog(
          `[Avy] ${detailAttempts[i]?.label} parse/fetch error: ${r.reason?.message || r.reason}`,
        );
      }
    });
  }

  // MWAC occasionally returns generic API link values; prefer a direct forecast page link fallback.
  if (props.center_id === 'MWAC') {
    if (
      !avalancheData.link ||
      avalancheData.link.includes('api.avalanche.org') ||
      avalancheData.link.length < 30
    ) {
      avalancheData = {
        ...avalancheData,
        link: 'https://www.mountwashingtonavalanchecenter.org/forecasts/#/presidential-range',
      };
    }
  }

  // CAIC-specific behavior:
  // Prefer official center text and do not inject generated summaries.
  if (props.center_id === 'CAIC') {
    avyLog('[Avy] CAIC detected. Preferring official center summary text.');
    avalancheData = {
      ...avalancheData,
      link: resolveAvalancheCenterLink({
        centerId: props.center_id,
        link: props.link,
        centerLink: props.center_link,
        lat: parsedLat,
        lon: parsedLon,
      }),
    };
  }

  if (detailDet) {
    const det = detailDet;
    if (det && Object.keys(det).length > 5) {
      const finalBL =
        det.bottom_line ||
        det.bottom_line_summary ||
        det.bottom_line_summary_text ||
        det.overall_summary ||
        det.summary;

      avyLog(
        `[Avy] Data retrieved for ${props.center_id}. BL length: ${finalBL?.length || 0}`,
      );

      if (det.published_time || det.updated_at) {
        avalancheData = {
          ...avalancheData,
          publishedTime: det.published_time || det.updated_at,
        };
      }
      const inferredExpiry = inferAvalancheExpiresTime(det);
      if (inferredExpiry) {
        avalancheData = { ...avalancheData, expiresTime: inferredExpiry };
      }

      if (finalBL && finalBL.length > 20) {
        avalancheData = { ...avalancheData, bottomLine: cleanForecastText(finalBL) };
      }

      const fetchedProblems =
        detailProblems.length > 0 ? detailProblems : getAvalancheProblemsFromDetail(det);
      if (fetchedProblems.length > 0) {
        avalancheData = { ...avalancheData, problems: fetchedProblems };
      }

      const safeLevel = (val) => {
        const n = parseInt(val, 10);
        return Number.isFinite(n) ? n : 0;
      };
      if (det.danger && det.danger.length > 0) {
        const currentDay =
          det.danger.find((d) => d.valid_day === 'current') || det.danger[0];
        const safeLabel = (lvl) =>
          Array.isArray(levelMap) && levelMap[lvl] ? levelMap[lvl] : 'Unknown';
        avalancheData = {
          ...avalancheData,
          elevations: {
            below: {
              level: safeLevel(currentDay.lower),
              label: safeLabel(safeLevel(currentDay.lower)),
            },
            at: {
              level: safeLevel(currentDay.middle),
              label: safeLabel(safeLevel(currentDay.middle)),
            },
            above: {
              level: safeLevel(currentDay.upper),
              label: safeLabel(safeLevel(currentDay.upper)),
            },
          },
        };
      } else if (det.danger_low) {
        const safeLabel = (lvl) =>
          Array.isArray(levelMap) && levelMap[lvl] ? levelMap[lvl] : 'Unknown';
        avalancheData = {
          ...avalancheData,
          elevations: {
            below: {
              level: safeLevel(det.danger_low),
              label: safeLabel(safeLevel(det.danger_low)),
            },
            at: {
              level: safeLevel(det.danger_mid),
              label: safeLabel(safeLevel(det.danger_mid)),
            },
            above: {
              level: safeLevel(det.danger_high),
              label: safeLabel(safeLevel(det.danger_high)),
            },
          },
        };
      }
    }
  } else {
    avyLog('[Avy] Fetch Failed: no usable detail payload from forecast/product endpoints.');
  }

  return avalancheData;
}

/**
 * Attempts scraper fallback for avalanche detail when API data is insufficient.
 */
async function tryScraperFallback({
  avalancheData,
  props,
  centerNoActiveForecast,
  fetchWithTimeout,
  avyLog,
}) {
  const hasGenericBottomLine =
    !avalancheData.bottomLine || avalancheData.bottomLine === props.travel_advice;
  const hasDetailedBottomLine =
    typeof avalancheData.bottomLine === 'string' &&
    avalancheData.bottomLine.length >= 120 &&
    !hasGenericBottomLine;
  const scrapeLink = normalizeExternalLink(props.link);
  const shouldScrape =
    !centerNoActiveForecast &&
    (hasGenericBottomLine ||
      (!avalancheData.problems.length && !hasDetailedBottomLine) ||
      (props.center_id === 'CAIC' && (avalancheData.bottomLine || '').length < 180)) &&
    !!scrapeLink;

  if (!shouldScrape) return avalancheData;

  avyLog(`[Avy] Engaging Scraper Fallback for ${props.center_id}`);
  try {
    let resolvedViaCenterJson = false;

    // UAC publishes machine-readable advisory JSON at /forecast/{zone}/json.
    if (props.center_id === 'UAC') {
      const uacJsonUrl = buildUtahForecastJsonUrl(
        scrapeLink || props.link || props.center_link || '',
      );
      if (uacJsonUrl) {
        try {
          const uacRes = await fetchWithTimeout(uacJsonUrl, {
            headers: DEFAULT_FETCH_HEADERS,
          });
          if (uacRes.ok) {
            const uacPayloads = parseAvalancheDetailPayloads(await uacRes.text());
            const uacAdvisory = extractUtahAvalancheAdvisory(uacPayloads[0]);
            if (
              uacAdvisory?.bottomLine ||
              (uacAdvisory?.problems && uacAdvisory.problems.length > 0)
            ) {
              if (uacAdvisory.bottomLine && uacAdvisory.bottomLine.length > 20) {
                avalancheData = {
                  ...avalancheData,
                  bottomLine: cleanForecastText(uacAdvisory.bottomLine),
                };
              }
              if (
                Array.isArray(uacAdvisory.problems) &&
                uacAdvisory.problems.length > 0
              ) {
                avalancheData = {
                  ...avalancheData,
                  problems: normalizeAvalancheProblemCollection(uacAdvisory.problems),
                };
              }
              if (uacAdvisory.publishedTime) {
                avalancheData = {
                  ...avalancheData,
                  publishedTime: uacAdvisory.publishedTime,
                };
              }
              resolvedViaCenterJson = true;
              avyLog('[Avy] UAC advisory JSON fallback applied.');
            } else {
              avyLog(
                '[Avy] UAC advisory JSON returned no usable bottom line/problems.',
              );
            }
          } else {
            avyLog(
              `[Avy] UAC advisory JSON request failed with status ${uacRes.status}.`,
            );
          }
        } catch (uacErr) {
          avyLog('[Avy] UAC advisory JSON fallback failed:', uacErr.message);
        }
      }
    }

    if (!resolvedViaCenterJson) {
      const pageRes = await fetchWithTimeout(scrapeLink, {
        headers: DEFAULT_FETCH_HEADERS,
      });
      if (!pageRes.ok) {
        avyLog(
          `[scraper] Non-OK response (${pageRes.status}) from ${scrapeLink}, skipping HTML scrape`,
        );
      } else {
        const pageText = await pageRes.text();
        const bottomLineCandidates = [];

        const blMatch = pageText.match(
          /"(bottom_line|bottom_line_summary|overall_summary)"\s*:\s*"((?:[^"\\]|\\.)+)"/,
        );

        if (blMatch && blMatch[2]) {
          bottomLineCandidates.push(blMatch[2].replace(/\\"/g, '"'));
        } else {
          const htmlSummary = pageText.match(
            /class="[^"]*(field--name-field-avalanche-summary|field-bottom-line)[^"]*"[^>]*>([\s\S]*?)<\/div>/,
          );
          if (htmlSummary && htmlSummary[2]) {
            const stripped = htmlSummary[2]
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            if (stripped.length > 0 && stripped.length < 5000) {
              bottomLineCandidates.push(stripped);
            }
          } else {
            const possibleLargeText = pageText.match(
              /"summary"\s*:\s*"((?:[^"\\]|\\.){100,})"/,
            );
            if (possibleLargeText && possibleLargeText[1]) {
              bottomLineCandidates.push(possibleLargeText[1].replace(/\\"/g, '"'));
            }
          }
        }

        if (props.center_id === 'CAIC') {
          const nextDataMatch = pageText.match(
            /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
          );
          if (nextDataMatch && nextDataMatch[1]) {
            try {
              const nextJson = JSON.parse(nextDataMatch[1]);
              const serialized = JSON.stringify(nextJson);
              for (const m of serialized.matchAll(
                /"(?:bottom_line|bottomLine|summary|forecastSummary|discussion)"\s*:\s*"([^"]{80,})"/g,
              )) {
                if (m[1]) bottomLineCandidates.push(m[1].replace(/\\"/g, '"'));
              }
            } catch (nextErr) {
              avyLog('[Avy] __NEXT_DATA__ parse failed:', nextErr.message);
            }
          }
        }

        const bestBottomLine = pickBestBottomLine(bottomLineCandidates);
        if (bestBottomLine) {
          avalancheData = { ...avalancheData, bottomLine: bestBottomLine };
        }

        const problemMatches = [
          ...pageText.matchAll(
            /"avalanche_problem_id":\s*\d+,\s*"name"\s*:\s*"([^"]+)"/g,
          ),
        ];
        if (problemMatches.length > 0) {
          const distinctProblems = [...new Set(problemMatches.map((m) => m[1]))];
          avalancheData = {
            ...avalancheData,
            problems: normalizeAvalancheProblemCollection(
              distinctProblems.map((name) => ({ name })),
            ),
          };
        }

        const lowerMatch = pageText.match(/"danger_lower"\s*:\s*(\d)/);
        const middleMatch = pageText.match(/"danger_middle"\s*:\s*(\d)/);
        const upperMatch = pageText.match(/"danger_upper"\s*:\s*(\d)/);

        if (lowerMatch && middleMatch && upperMatch) {
          const l = parseInt(lowerMatch[1]);
          const m = parseInt(middleMatch[1]);
          const u = parseInt(upperMatch[1]);
          const levelMap = AVALANCHE_LEVEL_LABELS;
          const safeLabel = (lvl) =>
            Array.isArray(levelMap) && levelMap[lvl] ? levelMap[lvl] : 'Unknown';
          avalancheData = {
            ...avalancheData,
            elevations: {
              below: { level: l, label: safeLabel(l) },
              at: { level: m, label: safeLabel(m) },
              above: { level: u, label: safeLabel(u) },
            },
          };
        }
      }
    }
  } catch (scrapeErr) {
    avyLog('[Avy] Scrape failed:', scrapeErr.message);
  }

  return avalancheData;
}

/**
 * Applies post-fetch processing: derived danger, expiry checks, and staleness warnings.
 */
function applyAvalanchePostProcessing({ avalancheData, alertTargetTimeIso }) {
  let result = applyDerivedOverallAvalancheDanger(avalancheData);

  const avalancheTargetMs = parseIsoTimeToMs(alertTargetTimeIso);
  const avalancheExpiresMs = parseIsoTimeToMsWithReference(
    result?.expiresTime,
    alertTargetTimeIso,
  );
  if (
    result?.coverageStatus === 'reported' &&
    avalancheTargetMs !== null &&
    avalancheExpiresMs !== null &&
    avalancheTargetMs > avalancheExpiresMs
  ) {
    result = {
      ...result,
      coverageStatus: 'expired_for_selected_start',
      dangerUnknown: true,
      bottomLine: cleanForecastText(
        `${result?.bottomLine || ''} NOTE: This bulletin expires before the selected start time. Treat this as stale guidance and verify the latest avalanche center update before departure.`,
      ),
    };
  }

  if (result?.coverageStatus === 'reported' && result?.publishedTime) {
    const pubMs = parseIsoTimeToMs(result.publishedTime);
    if (pubMs !== null) {
      const ageHours = (Date.now() - pubMs) / (1000 * 60 * 60);
      if (ageHours > 72) {
        result = {
          ...result,
          dangerUnknown: true,
          staleWarning: '72h',
          bottomLine: cleanForecastText(
            `${result?.bottomLine || ''} NOTE: This bulletin is over 72 hours old and should be treated as expired. Check the avalanche center for a current forecast before departure.`,
          ),
        };
      } else if (ageHours > 48) {
        result = { ...result, staleWarning: '48h' };
      }
    }
  }

  return result;
}

module.exports = {
  fetchAvalanchePipeline,
  applyAvalanchePostProcessing,
};
