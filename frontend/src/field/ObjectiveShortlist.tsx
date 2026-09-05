import { useCallback, useEffect, useId, useState } from 'react';
import { ArrowRight, MapPin, Search, X } from 'lucide-react';
import type L from 'leaflet';
import type { Workspace } from './model/useWorkspace';
import { useSearchSuggestions } from '../hooks/useSearchSuggestions';
import { useObjectiveShortlist } from './model/useObjectiveShortlist';
import { SHORTLIST_KEY, objectiveFrom, readShortlist, shortlistDates, shortlistValidation, sameChoice, rankShortlist,
  type ShortlistState, type ShortlistChoice, type ShortlistObjective } from '../app/objective-shortlist';
import { resolveObjectiveTimeZone } from '../app/planned-start';
import { addDaysToIsoDate } from '../app/core';
import { dateLabel, ageLabel } from './data';
import type { MultiDayTripForecastDay } from '../app/trip-forecast';
import './shortlist.css';

const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value);
const tone = (day: MultiDayTripForecastDay) => day.decisionLevel === 'GO' ? 'go' : day.decisionLevel === 'NO-GO' ? 'blocked' : 'caution';

export default function ObjectiveShortlist({ workspace: w }: { workspace: Workspace }) {
  const id = useId();
  const [state, setState] = useState<ShortlistState>(() => readShortlist({ objectives: [], startDate: w.tripStartDate,
    durationDays: 2, startTime: w.tripStartTime, hours: w.travelWindowHours, planA: null, planB: null }));
  const [feedback, setFeedback] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [selected, setSelected] = useState<{ objectiveId: string; date: string } | null>(null);
  useEffect(() => {
    let failed = false;
    try { localStorage.setItem(SHORTLIST_KEY, JSON.stringify(state)); }
    catch { failed = true; }
    // Reflect the result of synchronizing with external browser storage.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStorageError(failed);
  }, [state]);
  const comparison = useObjectiveShortlist(state, w.preferences, {
    accountKey: w.accountUserId || 'guest',
    onUsageUpdated: w.handleMultiDayUsageUpdated, onUsageLimitReached: w.handleMultiDayUsageLimitReached,
  });
  const add = useCallback((position: L.LatLng, name?: string) => {
    const objective = objectiveFrom({ lat: position.lat, lon: position.lng, name: name || `${position.lat}, ${position.lng}` });
    if (!objective || comparison.loading) return;
    if (state.objectives.some(o => o.id === objective.id)) { setFeedback('That location is already on your shortlist.'); return; }
    if (state.objectives.length >= 5) { setFeedback('Your shortlist has 5 objectives. Remove one to add another.'); return; }
    setState(current => ({ ...current, objectives: [...current.objectives, objective] }));
    setFeedback(`${objective.name} added.`);
  }, [comparison.loading, state.objectives]);
  const search = useSearchSuggestions({ initialSearchQuery: '', updateObjectivePosition: add });
  const { searchWrapperRef, searchInputRef } = search;
  const dates = shortlistDates(state);
  const validation = shortlistValidation(state);
  const ranked = rankShortlist(comparison.results, state.hours);
  const best = ranked[0];
  const bestObjective = state.objectives.find(o => o.id === best?.objectiveId);
  const ties = best ? ranked.filter(r => r.day.decisionLevel === best.day.decisionLevel && r.day.score === best.day.score).length : 0;
  const selectedObjective = state.objectives.find(o => o.id === selected?.objectiveId);
  const selectedDay = comparison.results.find(r => r.objectiveId === selected?.objectiveId)?.days.find(d => d.date === selected?.date);
  function open(objective: ShortlistObjective, choice: ShortlistChoice) {
    w.handleOpenComparisonPlan({ lat: objective.lat, lon: objective.lon, objectiveName: objective.name,
      searchQuery: objective.name, forecastDate: choice.date, alpineStartTime: choice.startTime,
      travelWindowHours: choice.hours, targetElevationInput: '' });
  }
  function save(slot: 'planA' | 'planB', choice: ShortlistChoice) {
    const other = slot === 'planA' ? 'planB' : 'planA';
    setState(current => ({ ...current, [slot]: choice, [other]: sameChoice(current[other], choice) ? null : current[other] }));
    setFeedback(`${slot === 'planA' ? 'Plan A' : 'Plan B'} saved on this browser.`);
  }
  function choiceFor(objectiveId: string, date: string): ShortlistChoice {
    return { objectiveId, date, startTime: state.startTime, hours: state.hours };
  }
  const highlights = [
    { label: 'Lightest departure gust', metric: (day: MultiDayTripForecastDay) => finite(day.windGustMph) ? -day.windGustMph : null,
      value: (day: MultiDayTripForecastDay) => w.formatWindDisplay(day.windGustMph) },
    { label: 'Lowest departure rain / snow chance', metric: (day: MultiDayTripForecastDay) => finite(day.precipChance) ? -day.precipChance : null,
      value: (day: MultiDayTripForecastDay) => `${day.precipChance}%` },
    { label: 'Most hours within your limits', metric: (day: MultiDayTripForecastDay) => day.travelTotalHours > 0 ? day.travelPassHours : null,
      value: (day: MultiDayTripForecastDay) => `${day.travelPassHours} of ${day.travelTotalHours} forecast hours` },
  ];
  return <section className="objective-shortlist" aria-label="Objective shortlist">
    <div className="shortlist-layout">
      <div className="field-plan-form shortlist-controls">
        <h2>Your shortlist <small>{state.objectives.length}/5</small></h2>
        <p className="field-muted">Choose mountains, trails, or coordinates. Each comparison checks the selected point.</p>
        <fieldset disabled={comparison.loading || state.objectives.length >= 5}>
          <div className="field-search" ref={searchWrapperRef} onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget)) search.setShowSuggestions(false);
          }}>
            <label htmlFor={`${id}-search`}>Add an objective</label>
            <div className="field-input-icon">
              <Search size={17} aria-hidden="true" />
              <input id={`${id}-search`} ref={searchInputRef} value={search.searchQuery} placeholder="Search place or coordinates"
                role="combobox" aria-expanded={search.showSuggestions} aria-controls={`${id}-results`} aria-autocomplete="list"
                aria-activedescendant={search.showSuggestions && search.activeSuggestionIndex >= 0 ? `${id}-suggestion-${search.activeSuggestionIndex}` : undefined}
                autoComplete="off" onFocus={search.handleFocus} onChange={search.handleInputChange} onKeyDown={search.handleSearchKeyDown} />
              {search.searchQuery && <button type="button" className="field-icon-button" aria-label="Clear objective search" onClick={() => {
                search.handleSearchClear(); searchInputRef.current?.focus({ preventScroll: true });
              }}><X size={15} /></button>}
            </div>
            {search.showSuggestions && <div className="field-search-results" id={`${id}-results`} role="listbox" aria-label="Objectives to add">
              {search.parsedTypedCoordinates && <button type="button" role="option" aria-selected="false" onMouseDown={e => e.preventDefault()} onClick={() => search.handleUseTypedCoordinates(search.searchQuery)}><MapPin size={15} />Add these coordinates</button>}
              {search.suggestions.map((item, index) => <button id={`${id}-suggestion-${index}`} type="button" role="option" key={`${item.lat}-${item.lon}-${index}`}
                aria-selected={search.activeSuggestionIndex === index} onMouseDown={e => e.preventDefault()} onClick={() => search.selectSuggestion(item)}>
                <MapPin size={15} /><span>{item.name}</span>
              </button>)}
              {!search.suggestions.length && <p>{search.searchLoading ? 'Searching…' : 'Search for a place or enter latitude, longitude.'}</p>}
            </div>}
          </div>
          {w.hasObjective && !w.objectiveDraftDirty && <button className="field-text-button" type="button" onClick={() => add(w.position, w.objectiveName)}>Add current objective</button>}
        </fieldset>
        <ul className="shortlist-objectives">
          {state.objectives.map(objective => <li key={objective.id}>
            <div><strong>{objective.name}</strong><small>{resolveObjectiveTimeZone(objective.lat, objective.lon) || 'Local time zone unavailable'}</small></div>
            <button type="button" className="field-icon-button" disabled={comparison.loading} aria-label={`Remove ${objective.name}`} onClick={() => {
              setState(current => ({ ...current, objectives: current.objectives.filter(o => o.id !== objective.id),
                planA: current.planA?.objectiveId === objective.id ? null : current.planA,
                planB: current.planB?.objectiveId === objective.id ? null : current.planB })); setFeedback(`${objective.name} removed.`);
            }}><X size={16} /></button>
          </li>)}
        </ul>
        <form onSubmit={event => { event.preventDefault(); setFeedback(''); void comparison.run(); }}>
          <fieldset disabled={comparison.loading}>
            <div className="field-input-grid">
              <label>First date<input type="date" required value={state.startDate} min={w.todayDate} max={w.maxForecastDate}
                onChange={e => setState(current => ({ ...current, startDate: e.target.value }))} /></label>
              <label>Days<select value={state.durationDays} onChange={e => setState(current => ({ ...current, durationDays: Number(e.target.value) }))}>
                {[2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n} days</option>)}
              </select></label>
              <label>Departure<input type="time" required value={state.startTime} onChange={e => setState(current => ({ ...current, startTime: e.target.value }))} /></label>
              <label>Trip hours<input type="number" min="1" max="24" step="1" required value={state.hours} onChange={e => setState(current => ({ ...current, hours: Number(e.target.value) }))} /></label>
            </div>
            <p className="field-muted">The same departure time in each objective’s local time zone. Limits follow your Preferences.</p>
            {validation && <p className="shortlist-validation">{validation}</p>}
            <button className="field-button field-button-primary" type="submit" disabled={!!validation || w.accountLoading}>
              {comparison.loading ? 'Comparing…' : 'Compare objectives'}<ArrowRight size={15} aria-hidden="true" />
            </button>
          </fieldset>
          {comparison.loading && <button className="field-text-button" type="button" onClick={comparison.cancel}>Stop comparison</button>}
          <p className="shortlist-allowance">Uses one multi-day comparison per objective. Your existing allowance applies.</p>
        </form>
        {feedback && <p role="status" className="field-feedback">{feedback}</p>}
        {storageError && <p role="alert" className="field-warning">Browser storage is unavailable. This shortlist will not survive a reload.</p>}
      </div>
      <div className="shortlist-content">
        <div className="shortlist-saved" aria-label="Saved plans">
          {(['planA', 'planB'] as const).map(slot => {
            const choice = state[slot], objective = state.objectives.find(o => o.id === choice?.objectiveId);
            return <section className="field-panel" key={slot}>
              <span className="field-kicker">{slot === 'planA' ? 'Plan A' : 'Plan B'}</span>
              {choice && objective ? <><h3>{objective.name}</h3><p>{dateLabel(choice.date)} · {choice.startTime} local · {choice.hours} hours</p>
                <div className="field-action-row"><button className="field-text-button" onClick={() => open(objective, choice)}>Open in planner <ArrowRight size={14} /></button>
                  <button className="field-text-button" aria-label={`Clear ${slot === 'planA' ? 'Plan A' : 'Plan B'}`} onClick={() => setState(current => ({ ...current, [slot]: null }))}>Clear</button></div></>
                : <><h3>{slot === 'planA' ? 'Your first choice' : 'Keep an alternative'}</h3><p>Select a result below to save this plan.</p></>}
            </section>;
          })}
        </div>
        <p className="shortlist-caption">Saved on this browser. Opening a plan lets you review details and generate a fresh full report.</p>
        {comparison.needsRefresh && <p className="field-feedback" role="status">Plan details or preferences changed. Compare again for matching forecasts.</p>}
        {comparison.loading && <p className="field-feedback" role="status">Comparing objectives · {comparison.results.length} of {state.objectives.length} checked.</p>}
        {!comparison.results.length && !comparison.loading && <div className="field-empty-state shortlist-intro">
          <MapPin size={30} aria-hidden="true" /><h2>Where should you go?</h2>
          <p>Add 2–5 objectives and choose your available dates. Compare hazards, weather windows, views, and comfort before saving your first choice and a backup.</p>
          <button className="field-button" onClick={() => setState(current => ({ ...current, startDate: (() => {
            const now = new Date(`${w.todayDate}T12:00:00Z`); return addDaysToIsoDate(w.todayDate, (6 - now.getUTCDay() + 7) % 7);
          })(), durationDays: 2 }))}>Use this weekend</button>
        </div>}
        {!!comparison.results.length && <>
          {!comparison.loading && <section className="field-panel shortlist-recommendation">
            <span className="field-kicker">Comparison outlook</span>
            <h2>{!best ? 'More evidence needed' : best.day.decisionLevel === 'NO-GO' ? 'No recommended option among ranked results' : best.day.decisionLevel === 'CAUTION' ? 'Leading option still needs caution' : 'Most favorable reported conditions'}</h2>
            {best && bestObjective ? <><p><strong>{bestObjective.name} · {dateLabel(best.day.date)}</strong></p><p>{best.day.decisionHeadline}</p>
              {ties > 1 && <p>{ties} options share this rank. Compare the tradeoffs below.</p>}</> : <p>No complete, scored hourly forecast is available to rank. Review missing evidence below.</p>}
            <p className="shortlist-caption">{comparison.results.reduce((count, result) => count + result.days.length, 0)} of {state.objectives.length * dates.length} options returned. Ranked by hazard decision, then the existing report score. Comfort does not affect ranking. Partial results and incomplete hourly windows are excluded. These are point forecasts; review route conditions and official sources before committing.</p>
          </section>}
          <div className="compare-highlights" aria-label="Objective weather tradeoffs" role="group">
            {highlights.map(highlight => {
              const candidates = comparison.results.flatMap(r => r.days.map(day => ({ objectiveId: r.objectiveId, day }))).filter(r => highlight.metric(r.day) !== null);
              const maximum = Math.max(...candidates.map(r => highlight.metric(r.day)!));
              const winners = candidates.filter(r => highlight.metric(r.day) === maximum);
              const first = winners[0], objective = state.objectives.find(o => o.id === first?.objectiveId);
              return <div key={highlight.label}><span className="field-kicker">{highlight.label}</span>
                {first && objective ? <><p>{highlight.value(first.day)}</p><small>{winners.length > 1 ? `${winners.length} options tied` : `${objective.name} · ${dateLabel(first.day.date)}`}</small><small>Weather tradeoff only; check each option’s hazards.</small></> : <p>Unavailable</p>}
              </div>;
            })}
          </div>
          <h2 className="shortlist-grid-heading">Objectives × dates</h2>
          <p className="shortlist-caption">Select a result for details and Plan A / Plan B. Scroll across for more dates. Gusts, rain / snow chance, and cloud cover are departure readings.</p>
          <div className="compare-table-scroll" role="region" tabIndex={0} aria-label="Objective and date comparison">
            <table className="compare-table shortlist-table"><caption>Conditions at each objective and date, departing {state.startTime} local for {state.hours} hours</caption>
              <thead><tr><th scope="col">Objective</th>{dates.map(date => <th scope="col" key={date}>{dateLabel(date)}</th>)}</tr></thead>
              <tbody>{state.objectives.map(objective => {
                const result = comparison.results.find(r => r.objectiveId === objective.id);
                return <tr key={objective.id}><th scope="row">{objective.name}<small>{resolveObjectiveTimeZone(objective.lat, objective.lon)}</small></th>
                  {dates.map(date => {
                    const day = result?.days.find(d => d.date === date);
                    const choice = choiceFor(objective.id, date);
                    return <td key={date} className={selected?.objectiveId === objective.id && selected.date === date ? 'is-selected' : ''}>
                      {day ? <button className="shortlist-cell" aria-pressed={selected?.objectiveId === objective.id && selected.date === date} aria-label={`Review ${objective.name}, ${dateLabel(date)}`} onClick={() => setSelected({ objectiveId: objective.id, date })}>
                        <span className={`compare-decision is-${tone(day)}`}>{day.decisionLevel}</span>
                        <strong>{finite(day.score) ? `${day.score}/100` : 'Score unavailable'}</strong>
                        <span>Gust {w.formatWindDisplay(day.windGustMph)}</span><span>Rain / snow {finite(day.precipChance) ? `${day.precipChance}%` : 'unavailable'}</span>
                        <span>{day.travelTotalHours > 0 ? `${day.travelPassHours}/${day.travelTotalHours} forecast hours within limits` : 'Hourly forecast unavailable'}</span>
                        <span>Cloud cover {finite(day.cloudCoverPct) ? `${day.cloudCoverPct}%` : 'unavailable'}</span>
                        <span>Comfort {finite(day.safetyData.pleasantness?.score) ? `${day.safetyData.pleasantness!.score}/100` : 'unavailable'}</span>
                        {day.partialData && <small className="compare-data-warning">Partial data</small>}
                        <small>Issued {ageLabel(day.sourceIssuedTime)}</small>
                        {sameChoice(state.planA, choice) && <span className="compare-selection">Plan A</span>}
                        {sameChoice(state.planB, choice) && <span className="compare-selection">Plan B</span>}
                      </button> : <><strong>{!result && comparison.loading ? 'Waiting…' : 'Unavailable'}</strong><small>{result?.error || (!result && comparison.loading ? 'Queued for comparison.' : 'No forecast for this date. Compare again to retry.')}</small></>}
                    </td>;
                  })}
                </tr>;
              })}</tbody>
            </table>
          </div>
          {selectedDay && selectedObjective && <section className="field-panel shortlist-detail" aria-label="Selected objective details">
            <div className="field-panel-heading"><div><span className="field-kicker">Selected option</span><h2>{selectedObjective.name}</h2><p>{dateLabel(selectedDay.date)} · {state.startTime} local · {state.hours} hours</p></div><span className={`compare-decision is-${tone(selectedDay)}`}>{selectedDay.decisionLevel}</span></div>
            <p>{selectedDay.decisionHeadline}</p>
            {selectedDay.apiWarning && <p className="field-warning">{selectedDay.apiWarning}</p>}
            <dl className="shortlist-details">
              <div><dt>Weather window</dt><dd>{selectedDay.travelTotalHours ? `${selectedDay.travelPassHours} of ${selectedDay.travelTotalHours} forecast hours within your limits` : 'Hourly forecast unavailable'}</dd></div>
              <div><dt>Views</dt><dd>{selectedDay.visibilitySummary || 'Visibility outlook unavailable'}{finite(selectedDay.cloudCoverPct) && ` · ${selectedDay.cloudCoverPct}% cloud cover at departure`}</dd></div>
              <div><dt>Comfort · separate from hazards</dt><dd>{finite(selectedDay.safetyData.pleasantness?.score) ? `${selectedDay.safetyData.pleasantness!.score}/100 · ${selectedDay.safetyData.pleasantness!.label}` : 'Comfort unavailable'}</dd></div>
              <div><dt>Source confidence</dt><dd>{finite(selectedDay.safetyData.safety.confidence) ? `${Math.round(selectedDay.safetyData.safety.confidence!)}%` : 'Unavailable'}{selectedDay.partialData ? ' · Partial data' : ''}</dd></div>
              <div><dt>Weather issued</dt><dd>{selectedDay.sourceIssuedTime ? new Date(selectedDay.sourceIssuedTime).toLocaleString() : 'Unavailable'}</dd></div>
              <div><dt>Active alerts</dt><dd>{selectedDay.alertCount}</dd></div>
            </dl>
            {!!selectedDay.safetyData.safety.confidenceReasons?.length && <p className="shortlist-caption">{selectedDay.safetyData.safety.confidenceReasons.join(' ')}</p>}
            <div className="field-action-row">
              <button className="field-button" aria-pressed={sameChoice(state.planA, choiceFor(selectedObjective.id, selectedDay.date))} onClick={() => save('planA', choiceFor(selectedObjective.id, selectedDay.date))}>Save as Plan A</button>
              <button className="field-button" aria-pressed={sameChoice(state.planB, choiceFor(selectedObjective.id, selectedDay.date))} onClick={() => save('planB', choiceFor(selectedObjective.id, selectedDay.date))}>Save as Plan B</button>
              <button className="field-button field-button-primary" onClick={() => open(selectedObjective, choiceFor(selectedObjective.id, selectedDay.date))}>Open in planner <ArrowRight size={15} /></button>
            </div>
          </section>}
        </>}
      </div>
    </div>
  </section>;
}
