// ============================================================
// ESPN API client + rendering for NFL / NBA / MLB scoreboard
// ============================================================

const LEAGUES = [
  { key: 'nfl', sport: 'football', league: 'nfl', icon: '🏈', label: 'NFL' },
  { key: 'nba', sport: 'basketball', league: 'nba', icon: '🏀', label: 'NBA' },
  { key: 'mlb', sport: 'baseball', league: 'mlb', icon: '⚾', label: 'MLB' },
  { key: 'nhl', sport: 'hockey', league: 'nhl', icon: '🏒', label: 'NHL' },
  { key: 'mls', sport: 'soccer', league: 'usa.1', icon: '⚽', label: 'MLS' },
  { key: 'epl', sport: 'soccer', league: 'eng.1', icon: '⚽', label: 'EPL' },
  { key: 'ucl', sport: 'soccer', league: 'uefa.champions', icon: '🏆', label: 'UCL' },
  { key: 'fifa.world', sport: 'soccer', league: 'fifa.world', icon: '🌍', label: 'World Cup' },
  { key: 'ncaaf', sport: 'football', league: 'college-football', icon: '🏈', label: 'NCAAF' },
  { key: 'ncaam', sport: 'basketball', league: 'mens-college-basketball', icon: '🏀', label: 'NCAAM' },
];

const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports';

// ── State ─────────────────────────────────────────────────

let state = {
  dateOffset: 0,
  leagueFilter: 'all',
  games: {},
  loading: true,
  error: null,
  favorites: JSON.parse(localStorage.getItem('sports-widget-favorites') || '[]'),
  showStandings: false,
  standings: {},
  allTeams: [],
  allTeamsLoaded: false,
  allTeamsLoading: false,
  allTeamsError: null,
  teamFilter: null,
  searchQuery: '',
  myTeamsCollapsed: null,
};

function saveFavorites() {
  localStorage.setItem('sports-widget-favorites', JSON.stringify(state.favorites));
}

function toggleFavorite(abbr) {
  const idx = state.favorites.indexOf(abbr);
  if (idx === -1) {
    state.favorites.push(abbr);
  } else {
    state.favorites.splice(idx, 1);
  }
  saveFavorites();
  render();
}

let refreshTimer = null;

// ── Helpers ───────────────────────────────────────────────

function getDateStr(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── ESPN Fetch ────────────────────────────────────────────

async function fetchLeague(leagueCfg, dateStr) {
  const url = `${BASE_URL}/${leagueCfg.sport}/${leagueCfg.league}/scoreboard?dates=${dateStr}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN ${leagueCfg.label}: ${res.status}`);
  const data = await res.json();
  return (data.events || []).map(ev => parseEvent(ev, leagueCfg));
}

function parseEvent(ev, leagueCfg) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;

  const status = comp.status || {};
  const statusType = status.type?.name || 'STATUS_SCHEDULED';
  const statusDetail = status.type?.shortDetail || status.type?.detail || '';
  const clock = status.displayClock || '';
  const period = status.period || 0;

  const homeComp = comp.competitors?.find(c => c.homeAway === 'home');
  const awayComp = comp.competitors?.find(c => c.homeAway === 'away');

  const parseTeam = (c) => {
    if (!c) return null;
    const rec = c.records?.[0]?.summary || '';
    return {
      id: c.team?.id || '',
      name: c.team?.displayName || c.team?.name || '',
      abbr: c.team?.abbreviation || '',
      logo: c.team?.logo || '',
      color: c.team?.color || '333333',
      score: c.score || '0',
      record: rec,
      winner: c.winner || false,
      linescores: (c.linescores || []).map(ls => ls.value),
    };
  };

  let spread = '';
  if (comp.odds?.[0]?.details) {
    spread = comp.odds[0].details;
  }

  let broadcast = '';
  if (comp.broadcasts?.[0]?.names?.[0]) {
    broadcast = comp.broadcasts[0].names[0];
  }

  return {
    id: ev.id,
    league: leagueCfg.key,
    leagueLabel: leagueCfg.label,
    leagueIcon: leagueCfg.icon,
    sport: leagueCfg.sport,
    leagueSlug: leagueCfg.league,
    date: ev.date,
    statusType,
    statusDetail,
    clock,
    period,
    home: parseTeam(homeComp),
    away: parseTeam(awayComp),
    spread,
    broadcast,
  };
}

async function fetchAllLeagues() {
  state.loading = true;
  state.error = null;
  render();

  try {
    const games = {};
    LEAGUES.forEach(l => { games[l.key] = []; });

    if (state.dateOffset === 1) {
      // Upcoming: fetch next 7 days
      const dayFetches = [];
      for (let day = 1; day <= 7; day++) {
        const dateStr = getDateStr(day);
        dayFetches.push(
          Promise.allSettled(LEAGUES.map(l => fetchLeague(l, dateStr)))
            .then(results => {
              LEAGUES.forEach((l, i) => {
                if (results[i].status === 'fulfilled') {
                  games[l.key].push(...results[i].value.filter(Boolean));
                }
              });
            })
        );
      }
      await Promise.all(dayFetches);
    } else {
      const dateStr = getDateStr(state.dateOffset);
      const results = await Promise.allSettled(
        LEAGUES.map(l => fetchLeague(l, dateStr))
      );
      LEAGUES.forEach((l, i) => {
        if (results[i].status === 'fulfilled') {
          games[l.key] = results[i].value.filter(Boolean);
        } else {
          console.warn(`Failed to fetch ${l.label}:`, results[i].reason);
        }
      });
    }

    state.games = games;
    state.loading = false;
    state.error = null;
  } catch (err) {
    state.loading = false;
    state.error = err.message;
  }

  render();
}

// ── Game Detail Fetch ─────────────────────────────────────

async function fetchGameDetail(game) {
  const url = `${BASE_URL}/${game.sport}/${game.leagueSlug}/summary?event=${game.id}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load game details`);
  return await res.json();
}

// ── Standings Fetch & Render ──────────────────────────────

async function fetchStandingsData() {
  state.loading = true;
  state.error = null;
  render();

  try {
    const leaguesToFetch = state.leagueFilter === 'all'
      ? LEAGUES.slice(0, 4)
      : LEAGUES.filter(l => l.key === state.leagueFilter);

    const standings = { ...state.standings };

    const results = await Promise.allSettled(
      leaguesToFetch.map(async (l) => {
        const url = `${BASE_URL}/${l.sport}/${l.league}/standings`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${l.label}: ${res.status}`);
        const data = await res.json();
        return { key: l.key, data };
      })
    );

    results.forEach(r => {
      if (r.status === 'fulfilled') {
        standings[r.value.key] = r.value.data;
      } else {
        console.warn(`Failed to fetch standings:`, r.reason);
      }
    });

    state.standings = standings;
    state.loading = false;
  } catch (err) {
    state.loading = false;
    state.error = err.message;
  }
  render();
}

function getStatValue(entry, statNames) {
  const stat = (entry.stats || []).find(s => 
    statNames.includes(s.name) || 
    statNames.includes(s.abbreviation) ||
    statNames.includes(s.type)
  );
  return stat ? stat.displayValue : '-';
}

function renderStandingsTable(title, entries, leagueKey) {
  const leagueCfg = LEAGUES.find(l => l.key === leagueKey);
  const sport = leagueCfg?.sport || '';
  const league = leagueCfg?.league || '';
  const isSoccer = sport === 'soccer';
  const isHockey = sport === 'hockey';

  let headers = '';
  if (isSoccer) {
    headers = `
      <th>Rank</th>
      <th>Team</th>
      <th class="standings-cell-center">W</th>
      <th class="standings-cell-center">D</th>
      <th class="standings-cell-center">L</th>
      <th class="standings-cell-center">PTS</th>
      <th class="standings-cell-right">STRK</th>
    `;
  } else if (isHockey) {
    headers = `
      <th>Rank</th>
      <th>Team</th>
      <th class="standings-cell-center">W</th>
      <th class="standings-cell-center">L</th>
      <th class="standings-cell-center">OTL</th>
      <th class="standings-cell-center">PTS</th>
      <th class="standings-cell-right">STRK</th>
    `;
  } else {
    headers = `
      <th>Rank</th>
      <th>Team</th>
      <th class="standings-cell-center">W</th>
      <th class="standings-cell-center">L</th>
      <th class="standings-cell-center">PCT</th>
      <th class="standings-cell-center">GB</th>
      <th class="standings-cell-right">STRK</th>
    `;
  }

  let rows = '';
  entries.forEach((entry, idx) => {
    const team = entry.team || {};
    const logoUrl = team.logos?.[0]?.href || '';
    const teamName = team.shortDisplayName || team.name || '';
    const teamAbbr = team.abbreviation || '';
    const isFav = state.favorites.includes(teamAbbr);

    const rank = getStatValue(entry, ['playoffSeed', 'position', 'rank', 'SEED', 'POS']) || (idx + 1);
    const wins = getStatValue(entry, ['wins', 'W']);
    const losses = getStatValue(entry, ['losses', 'L']);
    const streak = getStatValue(entry, ['streak', 'STRK']);

    let statsCells = '';
    if (isSoccer) {
      const draws = getStatValue(entry, ['ties', 'draws', 'T', 'D']);
      const pts = getStatValue(entry, ['points', 'PTS']);
      statsCells = `
        <td class="standings-cell-center">${wins}</td>
        <td class="standings-cell-center">${draws}</td>
        <td class="standings-cell-center">${losses}</td>
        <td class="standings-cell-center font-weight-bold" style="color: var(--text-accent); font-weight: 700;">${pts}</td>
      `;
    } else if (isHockey) {
      const otl = getStatValue(entry, ['otLosses', 'OTL', 'otlosses']);
      const pts = getStatValue(entry, ['points', 'PTS']);
      statsCells = `
        <td class="standings-cell-center">${wins}</td>
        <td class="standings-cell-center">${losses}</td>
        <td class="standings-cell-center">${otl}</td>
        <td class="standings-cell-center font-weight-bold" style="color: var(--text-accent); font-weight: 700;">${pts}</td>
      `;
    } else {
      const pct = getStatValue(entry, ['winPercent', 'PCT']);
      const gb = getStatValue(entry, ['gamesBehind', 'GB']);
      statsCells = `
        <td class="standings-cell-center">${wins}</td>
        <td class="standings-cell-center">${losses}</td>
        <td class="standings-cell-center">${pct}</td>
        <td class="standings-cell-center">${gb}</td>
      `;
    }

    rows += `
      <tr>
        <td style="color: var(--text-muted); font-weight: 600; width: 40px;">${rank}</td>
        <td>
          <div class="standings-team-cell team-clickable" data-team-id="${team.id}" data-sport="${sport}" data-league="${league}">
            ${logoUrl ? `<img class="standings-team-logo" src="${logoUrl}" alt="" loading="lazy" />` : ''}
            <span class="standings-team-name">${escapeHtml(teamName)} ${isFav ? '<span style="color: #f59e0b; font-size: 10px;">⭐</span>' : ''}</span>
          </div>
        </td>
        ${statsCells}
        <td class="standings-cell-right" style="color: var(--text-muted); font-size: 11px;">${streak}</td>
      </tr>
    `;
  });

  return `
    ${title ? `<div class="standings-conference-header">${escapeHtml(title)}</div>` : ''}
    <div class="standings-table-wrap">
      <table class="standings-table">
        <thead>
          <tr>
            ${headers}
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function renderStandings() {
  const container = document.getElementById('games-container');

  if (state.loading) {
    container.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading standings...</p>
      </div>`;
    return;
  }

  if (state.error) {
    container.innerHTML = `
      <div class="error-state">
        <div class="error-icon">⚠️</div>
        <h3>Something went wrong</h3>
        <p>${escapeHtml(state.error)}</p>
        <button onclick="fetchStandingsData()">Retry</button>
      </div>`;
    return;
  }

  const leaguesToShow = state.leagueFilter === 'all'
    ? LEAGUES.slice(0, 4)
    : LEAGUES.filter(l => l.key === state.leagueFilter);

  let html = '';
  let standingsCount = 0;

  for (const leagueCfg of leaguesToShow) {
    const data = state.standings?.[leagueCfg.key];
    if (!data) continue;

    standingsCount++;
    const leagueName = data.name || leagueCfg.label;

    html += `
      <div class="league-standings-section">
        <div class="league-header" style="margin-top: 16px;">
          <span class="league-icon">${leagueCfg.icon}</span>
          <h2>${escapeHtml(leagueName)}</h2>
        </div>
    `;

    const children = data.children || [];
    if (children.length > 0) {
      for (const child of children) {
        const title = child.name || child.displayName || '';
        const entries = child.standings?.entries || [];
        if (entries.length === 0) continue;

        html += renderStandingsTable(title, entries, leagueCfg.key);
      }
    } else {
      const entries = data.standings?.entries || [];
      if (entries.length > 0) {
        html += renderStandingsTable('', entries, leagueCfg.key);
      }
    }

    html += `</div>`;
  }

  if (standingsCount === 0) {
    container.innerHTML = `
      <div class="detail-empty">
        No standings available. Make sure a specific league is selected or click refresh.
      </div>`;
  } else {
    container.innerHTML = html;
  }
}

// ── Rendering (Main List) ─────────────────────────────────


function render() {
  if (state.showStandings) {
    renderStandings();
    return;
  }

  // Update active filter banner
  const filterBanner = document.getElementById('filter-banner');
  if (filterBanner) {
    if (state.teamFilter) {
      filterBanner.style.display = 'block';
      filterBanner.innerHTML = `
        <div class="filter-banner-content">
          <div class="filter-banner-team">
            ${state.teamFilter.logo ? `<img class="filter-banner-logo" src="${escapeHtml(state.teamFilter.logo)}" alt="" />` : '🏆'}
            <span>Showing games for <strong>${escapeHtml(state.teamFilter.name)}</strong></span>
          </div>
          <button id="clear-team-filter" class="clear-filter-btn">Clear</button>
        </div>
      `;
      document.getElementById('clear-team-filter')?.addEventListener('click', () => {
        clearTeamFilter();
      });
    } else {
      filterBanner.style.display = 'none';
      filterBanner.innerHTML = '';
    }
  }

  const container = document.getElementById('games-container');

  if (state.loading) {
    container.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading scores...</p>
      </div>`;
    return;
  }

  if (state.error) {
    container.innerHTML = `
      <div class="error-state">
        <div class="error-icon">⚠️</div>
        <h3>Something went wrong</h3>
        <p>${escapeHtml(state.error)}</p>
        <button onclick="fetchAllLeagues()">Retry</button>
      </div>`;
    return;
  }

  const leaguesToShow = state.leagueFilter === 'all'
    ? LEAGUES
    : LEAGUES.filter(l => l.key === state.leagueFilter);

  let html = '';
  let totalGames = 0;

  // ── My Teams section ──
  if (state.favorites.length > 0 && !state.teamFilter) {
    const favGames = [];
    for (const leagueCfg of leaguesToShow) {
      for (const game of (state.games[leagueCfg.key] || [])) {
        if (state.favorites.includes(game.away?.abbr) || state.favorites.includes(game.home?.abbr)) {
          favGames.push(game);
        }
      }
    }
    if (favGames.length > 0) {
      const isCollapsed = state.myTeamsCollapsed !== null ? state.myTeamsCollapsed : (state.dateOffset === 1);
      html += `
        <section class="league-section my-teams-section${isCollapsed ? ' collapsed' : ''}">
          <div class="league-header collapsible-header" id="my-teams-header" style="cursor: pointer; user-select: none; display: flex; justify-content: space-between; align-items: center; width: 100%;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="league-icon">⭐</span>
              <h2>MY TEAMS</h2>
              <span class="game-count">${favGames.length} game${favGames.length !== 1 ? 's' : ''}</span>
            </div>
            <span class="collapse-chevron" style="transition: transform 0.2s ease; transform: rotate(${isCollapsed ? '-90deg' : '0deg'}); font-size: 10px; color: var(--text-secondary); margin-right: 4px;">▼</span>
          </div>
          <div class="my-teams-content" style="display: ${isCollapsed ? 'none' : 'block'};">
            ${favGames.map(g => renderGameCard(g)).join('')}
          </div>
        </section>`;
    }
  }

  if (state.dateOffset === 1) {
    // Upcoming: group games by date, then by league
    let allGames = [];
    for (const leagueCfg of leaguesToShow) {
      for (const game of (state.games[leagueCfg.key] || [])) {
        allGames.push(game);
      }
    }

    if (state.teamFilter) {
      allGames = allGames.filter(g => 
        (g.away?.id === state.teamFilter.id || g.home?.id === state.teamFilter.id) && 
        g.league === state.teamFilter.leagueKey
      );
    }

    const dateGroups = new Map();
    for (const game of allGames) {
      const d = new Date(game.date);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      if (!dateGroups.has(dateKey)) dateGroups.set(dateKey, { date: d, games: [] });
      dateGroups.get(dateKey).games.push(game);
    }

    const sorted = [...dateGroups.entries()].sort((a, b) => a[1].date - b[1].date);

    for (const [, { date, games }] of sorted) {
      const dateLabel = date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
      html += `<div class="date-group-header">${dateLabel}</div>`;

      for (const leagueCfg of leaguesToShow) {
        const leagueGames = games.filter(g => g.league === leagueCfg.key);
        if (leagueGames.length === 0) continue;
        totalGames += leagueGames.length;

        html += `
          <section class="league-section" data-league="${leagueCfg.key}">
            <div class="league-header">
              <span class="league-icon">${leagueCfg.icon}</span>
              <h2>${leagueCfg.label}</h2>
              <span class="game-count">${leagueGames.length} game${leagueGames.length !== 1 ? 's' : ''}</span>
            </div>
            ${leagueGames.map(g => renderGameCard(g)).join('')}
          </section>`;
      }
    }
  } else {
    for (const leagueCfg of leaguesToShow) {
      let games = state.games[leagueCfg.key] || [];
      if (state.teamFilter) {
        games = games.filter(g => 
          (g.away?.id === state.teamFilter.id || g.home?.id === state.teamFilter.id) && 
          g.league === state.teamFilter.leagueKey
        );
      }
      if (games.length === 0) continue;
      totalGames += games.length;

      html += `
        <section class="league-section" data-league="${leagueCfg.key}">
          <div class="league-header">
            <span class="league-icon">${leagueCfg.icon}</span>
            <h2>${leagueCfg.label}</h2>
            <span class="game-count">${games.length} game${games.length !== 1 ? 's' : ''}</span>
          </div>
          ${games.map(g => renderGameCard(g)).join('')}
        </section>`;
    }
  }

  if (totalGames === 0) {
    const label = state.dateOffset === -1 ? 'yesterday' : state.dateOffset === 1 ? 'upcoming' : 'today';
    html = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <h3>No games ${label}</h3>
        <p>Check another date or sport — games will appear when scheduled.</p>
      </div>`;
  }

  const now = new Date();
  html += `<div class="last-updated">Updated ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>`;

  container.innerHTML = html;
}

function renderGameCard(game) {
  const isLive = game.statusType === 'STATUS_IN_PROGRESS';
  const isFinal = game.statusType === 'STATUS_FINAL';
  const isScheduled = game.statusType === 'STATUS_SCHEDULED';

  const liveClass = isLive ? ' live' : '';

  const awayWinClass = isFinal ? (game.away?.winner ? ' winner' : ' loser') : '';
  const homeWinClass = isFinal ? (game.home?.winner ? ' winner' : ' loser') : '';

  let centerHtml;
  if (isScheduled) {
    centerHtml = `
      <span class="game-time">${formatTime(game.date)}</span>
      ${game.spread ? `<span class="game-spread">${escapeHtml(game.spread)}</span>` : ''}
      ${game.broadcast ? `<span class="game-status scheduled">${escapeHtml(game.broadcast)}</span>` : ''}
    `;
  } else {
    centerHtml = `
      <div class="game-score">
        <span>${game.away?.score || 0}</span>
        <span class="score-separator">–</span>
        <span>${game.home?.score || 0}</span>
      </div>
      <span class="game-status ${isLive ? 'live' : 'final'}">${escapeHtml(game.statusDetail)}</span>
    `;
  }

  let lineScoreHtml = '';
  if (!isScheduled && game.away?.linescores?.length > 0) {
    const periods = game.away.linescores;
    const periodLabels = getPeriodLabels(game.league, periods.length);

    lineScoreHtml = `
      <div class="line-scores">
        ${periods.map((_, i) => `
          <div class="line-score-item">
            <span class="line-score-header">${periodLabels[i]}</span>
            <span class="line-score-val away">${game.away.linescores[i] ?? '-'}</span>
            <span class="line-score-val home">${game.home?.linescores?.[i] ?? '-'}</span>
          </div>
        `).join('')}
        <div class="line-score-item">
          <span class="line-score-header">T</span>
          <span class="line-score-val away">${game.away?.score || 0}</span>
          <span class="line-score-val home">${game.home?.score || 0}</span>
        </div>
      </div>`;
  }

  return `
    <article class="game-card${liveClass}" data-game-id="${game.id}" data-league="${game.league}">
      <div class="game-row">
        <div class="team away${awayWinClass} team-clickable" data-team-id="${game.away?.id}" data-sport="${game.sport}" data-league="${game.leagueSlug}">
          <img class="team-logo" src="${game.away?.logo || ''}" alt="${game.away?.abbr || ''}" loading="lazy" />
          <div class="team-info">
            <span class="team-name">${escapeHtml(game.away?.abbr)}<button class="fav-star${state.favorites.includes(game.away?.abbr) ? ' is-favorite' : ''}" data-fav-abbr="${game.away?.abbr}">${state.favorites.includes(game.away?.abbr) ? '⭐' : '☆'}</button></span>
            <span class="team-record">${escapeHtml(game.away?.record)}</span>
          </div>
        </div>
        <div class="game-center">
          ${centerHtml}
        </div>
        <div class="team home${homeWinClass} team-clickable" data-team-id="${game.home?.id}" data-sport="${game.sport}" data-league="${game.leagueSlug}">
          <img class="team-logo" src="${game.home?.logo || ''}" alt="${game.home?.abbr || ''}" loading="lazy" />
          <div class="team-info">
            <span class="team-name">${escapeHtml(game.home?.abbr)}<button class="fav-star${state.favorites.includes(game.home?.abbr) ? ' is-favorite' : ''}" data-fav-abbr="${game.home?.abbr}">${state.favorites.includes(game.home?.abbr) ? '⭐' : '☆'}</button></span>
            <span class="team-record">${escapeHtml(game.home?.record)}</span>
          </div>
        </div>
      </div>
      ${lineScoreHtml}
    </article>`;
}

function getPeriodLabels(league, count) {
  if (league === 'mlb') {
    return Array.from({ length: count }, (_, i) => String(i + 1));
  }
  const labels = ['Q1', 'Q2', 'Q3', 'Q4'];
  for (let i = 4; i < count; i++) {
    labels.push(count === 5 ? 'OT' : `OT${i - 3}`);
  }
  return labels;
}

// ══════════════════════════════════════════════════════════
// GAME DETAIL MODAL
// ══════════════════════════════════════════════════════════

function findGameById(id) {
  for (const league of LEAGUES) {
    const games = state.games[league.key] || [];
    const found = games.find(g => g.id === id);
    if (found) return found;
  }
  return null;
}

async function openGameDetail(gameId) {
  const game = findGameById(gameId);
  if (!game) return;

  // Create and show modal immediately with loading state
  let modal = document.getElementById('game-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'game-detail-modal';
    document.getElementById('app').appendChild(modal);
  }

  const awayColor = `#${game.away?.color || '333'}`;
  const homeColor = `#${game.home?.color || '333'}`;

  modal.innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-sheet" id="modal-sheet">
        <div class="modal-header-bg" style="background: linear-gradient(135deg, ${awayColor}88 0%, #0a0f0a 50%, ${homeColor}88 100%);">
          <button class="modal-close" id="modal-close-btn">✕</button>
          <div class="modal-score-header">
            <div class="modal-team-col">
              <img class="modal-team-logo" src="${game.away?.logo || ''}" alt="${game.away?.abbr}" />
              <span class="modal-team-name">${escapeHtml(game.away?.name)}</span>
              <span class="modal-team-record">${escapeHtml(game.away?.record)}</span>
            </div>
            <div class="modal-score-center">
              <div class="modal-big-score">
                <span>${game.away?.score || 0}</span>
                <span class="modal-score-divider">–</span>
                <span>${game.home?.score || 0}</span>
              </div>
              <span class="modal-game-status ${game.statusType === 'STATUS_IN_PROGRESS' ? 'live' : ''}">${escapeHtml(game.statusDetail)}</span>
            </div>
            <div class="modal-team-col">
              <img class="modal-team-logo" src="${game.home?.logo || ''}" alt="${game.home?.abbr}" />
              <span class="modal-team-name">${escapeHtml(game.home?.name)}</span>
              <span class="modal-team-record">${escapeHtml(game.home?.record)}</span>
            </div>
          </div>
        </div>
        <div class="modal-body">
          <div class="loading-state" style="padding: 40px 20px;">
            <div class="spinner"></div>
            <p>Loading game details...</p>
          </div>
        </div>
      </div>
    </div>`;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Bind close
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });

  // Fetch detail data
  try {
    const detail = await fetchGameDetail(game);
    renderModalBody(game, detail);
  } catch (err) {
    document.querySelector('.modal-body').innerHTML = `
      <div class="error-state" style="padding: 40px 20px;">
        <div class="error-icon">⚠️</div>
        <h3>Couldn't load details</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>`;
  }
}

function closeModal() {
  const modal = document.getElementById('game-detail-modal');
  if (modal) {
    modal.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => { modal.innerHTML = ''; }, 300);
  }
}

// ── Team Stats Modal & View ───────────────────────────────

async function openTeamDetail(teamId, sport, league) {
  if (!teamId) return;

  let modal = document.getElementById('team-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'team-detail-modal';
    document.getElementById('app').appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-overlay" id="team-modal-overlay">
      <div class="modal-sheet" id="team-modal-sheet" style="max-height: 80vh;">
        <div class="modal-header-bg" id="team-modal-header" style="padding: 24px; position: relative; border-bottom: 1px solid var(--border-card);">
          <button class="modal-close" id="team-modal-close-btn">✕</button>
          <div style="display: flex; align-items: center; gap: 16px;">
            <div id="team-modal-logo-container" style="width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.05); border-radius: var(--radius-sm);">
              <div class="spinner" style="width: 24px; height: 24px; border-width: 2.5px;"></div>
            </div>
            <div>
              <h2 id="team-modal-title" style="margin: 0; font-size: 20px; font-weight: 800; color: #fff;">Loading...</h2>
              <p id="team-modal-subtitle" style="margin: 4px 0 0; font-size: 13px; color: var(--text-secondary);"></p>
            </div>
          </div>
        </div>
        <div class="modal-body" id="team-modal-body" style="padding: 20px; overflow-y: auto;">
          <div class="loading-state" style="padding: 40px 20px;">
            <div class="spinner"></div>
            <p>Loading team stats...</p>
          </div>
        </div>
      </div>
    </div>`;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Bind close
  document.getElementById('team-modal-close-btn').addEventListener('click', closeTeamModal);
  document.getElementById('team-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'team-modal-overlay') closeTeamModal();
  });

  try {
    const url = `${BASE_URL}/${sport}/${league}/teams/${teamId}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load team data`);
    const data = await res.json();
    renderTeamModal(data.team, sport, league);
  } catch (err) {
    document.getElementById('team-modal-body').innerHTML = `
      <div class="error-state" style="padding: 40px 20px;">
        <div class="error-icon">⚠️</div>
        <h3>Couldn't load stats</h3>
        <p>${escapeHtml(err.message)}</p>
      </div>`;
  }
}

function closeTeamModal() {
  const modal = document.getElementById('team-detail-modal');
  if (modal) {
    modal.classList.remove('open');
    if (!document.getElementById('game-detail-modal')?.classList.contains('open')) {
      document.body.style.overflow = '';
    }
    setTimeout(() => { modal.innerHTML = ''; }, 300);
  }
}

function renderTeamModal(team, sport, league) {
  const titleEl = document.getElementById('team-modal-title');
  const subtitleEl = document.getElementById('team-modal-subtitle');
  const logoContainer = document.getElementById('team-modal-logo-container');
  const headerEl = document.getElementById('team-modal-header');
  const bodyEl = document.getElementById('team-modal-body');

  const color = team.color ? `#${team.color}` : 'var(--border-card)';
  headerEl.setAttribute('style', `background: linear-gradient(135deg, ${color}cc 0%, #0a0f0a 100%); padding: 24px; position: relative; border-bottom: 1px solid var(--border-card);`);

  titleEl.textContent = team.displayName || team.name || '';
  subtitleEl.textContent = team.standingSummary || '';

  const logoUrl = team.logos?.[0]?.href || '';
  logoContainer.innerHTML = logoUrl ? `<img src="${logoUrl}" style="width: 50px; height: 50px; object-fit: contain;" alt="" />` : '🏆';

  // Extract stats
  const recordItems = team.record?.items || [];
  const overallItem = recordItems.find(i => i.type === 'total') || {};
  const homeItem = recordItems.find(i => i.type === 'home') || {};
  const roadItem = recordItems.find(i => i.type === 'road') || {};
  const divItem = recordItems.find(i => i.type === 'vsdiv') || {};
  const confItem = recordItems.find(i => i.type === 'vsconf') || {};
  const last10Item = recordItems.find(i => i.type === 'lasttengames') || {};

  const overallRec = overallItem.summary || overallItem.displayValue || '-';
  const homeRec = homeItem.summary || homeItem.displayValue || '-';
  const roadRec = roadItem.summary || roadItem.displayValue || '-';
  const divRec = divItem.displayValue || divItem.summary || '-';
  const confRec = confItem.displayValue || confItem.summary || '-';
  const last10Rec = last10Item.displayValue || last10Item.summary || '-';

  const statsList = overallItem.stats || [];
  const getVal = (name) => {
    const st = statsList.find(s => s.name === name);
    if (!st) return '-';
    if (typeof st.value === 'number') {
      if (st.name.startsWith('avg')) return st.value.toFixed(1);
      return st.value;
    }
    return st.displayValue || st.value;
  };

  const ppg = getVal('avgPointsFor');
  const pag = getVal('avgPointsAgainst');
  const diff = getVal('differential');
  const gp = getVal('gamesPlayed');
  const streak = getVal('streak');
  let formattedStreak = '-';
  if (streak !== '-') {
    if (typeof streak === 'number') {
      formattedStreak = streak > 0 ? 'W' + streak : (streak < 0 ? 'L' + Math.abs(streak) : '-');
    } else {
      formattedStreak = String(streak);
    }
  }

  let statsHtml = `
    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 20px;">
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-card); border-radius: var(--radius-sm); padding: 12px; text-align: center;">
        <div style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 4px;">Record</div>
        <div style="font-size: 18px; font-weight: 800; color: #fff;">${escapeHtml(overallRec)}</div>
      </div>
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-card); border-radius: var(--radius-sm); padding: 12px; text-align: center;">
        <div style="font-size: 10px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; margin-bottom: 4px;">Streak</div>
        <div style="font-size: 18px; font-weight: 800; color: var(--text-accent);">${escapeHtml(formattedStreak)}</div>
      </div>
    </div>

    <h3 style="font-size: 12px; text-transform: uppercase; color: var(--text-accent); letter-spacing: 0.5px; font-weight: 800; margin: 0 0 8px;">Split Records</h3>
    <table class="standings-table" style="margin-bottom: 20px; font-size: 13px;">
      <tbody>
        <tr>
          <td>Home</td>
          <td class="standings-cell-right" style="font-weight: 700;">${escapeHtml(homeRec)}</td>
        </tr>
        <tr>
          <td>Away</td>
          <td class="standings-cell-right" style="font-weight: 700;">${escapeHtml(roadRec)}</td>
        </tr>
        ${divRec !== '-' ? `<tr><td>vs Division</td><td class="standings-cell-right" style="font-weight: 700;">${escapeHtml(divRec)}</td></tr>` : ''}
        ${confRec !== '-' ? `<tr><td>vs Conference</td><td class="standings-cell-right" style="font-weight: 700;">${escapeHtml(confRec)}</td></tr>` : ''}
        ${last10Rec !== '-' ? `<tr><td>Last 10</td><td class="standings-cell-right" style="font-weight: 700;">${escapeHtml(last10Rec)}</td></tr>` : ''}
      </tbody>
    </table>
  `;

  if (ppg !== '-' || pag !== '-') {
    const isSoccer = sport === 'soccer';
    const pointsLabel = isSoccer ? 'Goals' : (sport === 'baseball' ? 'Runs' : 'Points');
    statsHtml += `
      <h3 style="font-size: 12px; text-transform: uppercase; color: var(--text-accent); letter-spacing: 0.5px; font-weight: 800; margin: 0 0 8px;">Scoring Averages</h3>
      <table class="standings-table" style="margin-bottom: 20px; font-size: 13px;">
        <tbody>
          <tr>
            <td>Avg ${pointsLabel} For</td>
            <td class="standings-cell-right" style="font-weight: 700;">${escapeHtml(ppg)}</td>
          </tr>
          <tr>
            <td>Avg ${pointsLabel} Against</td>
            <td class="standings-cell-right" style="font-weight: 700;">${escapeHtml(pag)}</td>
          </tr>
          <tr>
            <td>Differential</td>
            <td class="standings-cell-right" style="font-weight: 700; color: ${diff > 0 ? 'var(--text-accent)' : (diff < 0 ? 'var(--text-live)' : 'inherit')}">${diff > 0 ? '+' : ''}${escapeHtml(diff)}</td>
          </tr>
          <tr>
            <td>Games Played</td>
            <td class="standings-cell-right" style="font-weight: 700;">${escapeHtml(gp)}</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  const links = (team.links || []).filter(l => l.href && (l.href.startsWith('http://') || l.href.startsWith('https://')));
  if (links.length > 0) {
    statsHtml += `
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px;">
        ${links.map(l => `
          <a href="#" class="external-link" data-url="${l.href}" style="font-size: 11px; color: var(--text-accent); border: 1px solid var(--border-card); padding: 4px 8px; border-radius: 4px; text-decoration: none; font-weight: 600; background: rgba(255,255,255,0.02); transition: all 0.2s ease;" onmouseover="this.style.background='var(--green-dark)'" onmouseout="this.style.background='rgba(255,255,255,0.02)'">
            ${escapeHtml(l.text)}
          </a>
        `).join('')}
      </div>
    `;
  }

  bodyEl.innerHTML = statsHtml;
}

function renderModalBody(game, detail) {
  const body = document.querySelector('.modal-body');
  if (!body) return;

  const isScheduled = game.statusType === 'STATUS_SCHEDULED';

  // Build tab content
  let html = '';

  // ── Tab Bar ──
  html += `
    <div class="detail-tabs">
      <button class="detail-tab active" data-tab="boxscore">Box Score</button>
      <button class="detail-tab" data-tab="stats">Team Stats</button>
      <button class="detail-tab" data-tab="leaders">Leaders</button>
      <button class="detail-tab" data-tab="scoring">Scoring</button>
    </div>
    <div class="detail-tab-content">`;

  // ── Box Score Tab ──
  html += `<div class="tab-panel active" data-panel="boxscore">`;
  html += renderBoxScore(game, detail);
  html += `</div>`;

  // ── Team Stats Tab ──
  html += `<div class="tab-panel" data-panel="stats">`;
  html += renderTeamStats(game, detail);
  html += `</div>`;

  // ── Leaders Tab ──
  html += `<div class="tab-panel" data-panel="leaders">`;
  html += renderLeaders(game, detail);
  html += `</div>`;

  // ── Scoring Tab ──
  html += `<div class="tab-panel" data-panel="scoring">`;
  html += renderScoringPlays(game, detail);
  html += `</div>`;

  html += `</div>`; // close detail-tab-content

  // ── Game Info Footer ──
  html += renderGameInfo(game, detail);

  body.innerHTML = html;

  // Tab switching
  body.querySelectorAll('.detail-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      body.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
      body.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      body.querySelector(`.tab-panel[data-panel="${tab.dataset.tab}"]`)?.classList.add('active');
    });
  });
}

// ── Box Score Rendering ───────────────────────────────────

function renderBoxScore(game, detail) {
  const boxscore = detail.boxscore;
  if (!boxscore) return '<div class="detail-empty">Box score not available</div>';

  // Get players by team
  const players = boxscore.players || [];
  if (players.length === 0) return '<div class="detail-empty">Box score not available yet</div>';

  let html = '';

  for (const teamData of players) {
    const teamInfo = teamData.team;
    const teamName = teamInfo?.displayName || teamInfo?.shortDisplayName || '???';
    const teamAbbr = teamInfo?.abbreviation || '';
    const teamLogo = teamInfo?.logo || '';

    html += `<div class="boxscore-team-section">
      <div class="boxscore-team-header team-clickable" data-team-id="${teamInfo?.id || ''}" data-sport="${game.sport}" data-league="${game.leagueSlug}">
        <img src="${teamLogo}" alt="${teamAbbr}" class="boxscore-team-icon" />
        <span>${escapeHtml(teamName)}</span>
      </div>`;

    // Each team has stat categories (e.g., batting/pitching for MLB, starters/bench for NBA)
    const stats = teamData.statistics || [];
    for (const statGroup of stats) {
      const groupName = statGroup.name || statGroup.type || '';
      const labels = (statGroup.labels || []);
      const athletes = statGroup.athletes || [];
      const totals = statGroup.totals || [];

      if (athletes.length === 0) continue;

      html += `<div class="boxscore-stat-group">
        <div class="boxscore-group-label">${escapeHtml(groupName)}</div>
        <div class="boxscore-table-wrap">
          <table class="boxscore-table">
            <thead><tr>
              <th class="player-col">Player</th>
              ${labels.map(l => `<th>${escapeHtml(l)}</th>`).join('')}
            </tr></thead>
            <tbody>`;

      for (const ath of athletes) {
        const name = ath.athlete?.displayName || ath.athlete?.shortName || '—';
        const position = ath.athlete?.position?.abbreviation || '';
        const vals = ath.stats || [];
        const didNotPlay = ath.didNotPlay || false;
        const reason = ath.reason || '';

        if (didNotPlay) {
          html += `<tr class="dnp-row">
            <td class="player-col"><span class="player-name">${escapeHtml(name)}</span> <span class="player-pos">${escapeHtml(position)}</span></td>
            <td colspan="${labels.length}" class="dnp-label">DNP${reason ? ' — ' + escapeHtml(reason) : ''}</td>
          </tr>`;
        } else {
          html += `<tr>
            <td class="player-col"><span class="player-name">${escapeHtml(name)}</span> <span class="player-pos">${escapeHtml(position)}</span></td>
            ${vals.map(v => `<td>${escapeHtml(String(v))}</td>`).join('')}
          </tr>`;
        }
      }

      // Totals row
      if (totals.length > 0) {
        html += `<tr class="totals-row">
          <td class="player-col"><strong>TOTALS</strong></td>
          ${totals.map(v => `<td><strong>${escapeHtml(String(v))}</strong></td>`).join('')}
        </tr>`;
      }

      html += `</tbody></table></div></div>`;
    }

    html += `</div>`;
  }

  return html;
}

// ── Team Stats Rendering ──────────────────────────────────

function renderTeamStats(game, detail) {
  const boxscore = detail.boxscore;
  const teams = boxscore?.teams || [];
  if (teams.length < 2) return '<div class="detail-empty">Team stats not available</div>';

  const away = teams.find(t => t.homeAway === 'away') || teams[0];
  const home = teams.find(t => t.homeAway === 'home') || teams[1];

  const awayStats = away.statistics || [];
  const homeStats = home.statistics || [];

  if (awayStats.length === 0) return '<div class="detail-empty">Team stats not available yet</div>';

  const awayTeam = away.team || {};
  const homeTeam = home.team || {};

  let html = `<div class="team-stats-comparison">`;

  // Header
  html += `
    <div class="stats-header-row">
      <div class="stats-team-label">
        <img src="${awayTeam.logo || ''}" class="stats-team-mini-logo" alt="" />
        <span>${escapeHtml(awayTeam.abbreviation || '')}</span>
      </div>
      <span class="stats-label">Stat</span>
      <div class="stats-team-label">
        <span>${escapeHtml(homeTeam.abbreviation || '')}</span>
        <img src="${homeTeam.logo || ''}" class="stats-team-mini-logo" alt="" />
      </div>
    </div>`;

  // Check if nested (MLB style)
  const isNested = awayStats[0] && (Array.isArray(awayStats[0].stats) || awayStats[0].statistics);

  if (isNested) {
    // Loop through categories
    for (const awayCat of awayStats) {
      const catName = awayCat.name || '';
      const catDisplayName = awayCat.displayName || awayCat.name || '';
      const homeCat = homeStats.find(c => c.name === catName) || {};
      const awayCatStats = awayCat.stats || awayCat.statistics || [];
      const homeCatStats = homeCat.stats || homeCat.statistics || [];

      if (awayCatStats.length === 0) continue;

      html += `<div class="stats-category-title">${escapeHtml(catDisplayName)}</div>`;

      for (const awayStat of awayCatStats) {
        const homeStat = homeCatStats.find(s => s.name === awayStat.name) || {};
        html += renderSingleStatRow(awayStat, homeStat);
      }
    }
  } else {
    // Flat style (NBA/NFL)
    for (const awayStat of awayStats) {
      const homeStat = homeStats.find(s => s.name === awayStat.name) || {};
      html += renderSingleStatRow(awayStat, homeStat);
    }
  }

  html += `</div>`;
  return html;
}

function getStatNumericValue(stat) {
  if (!stat) return 0;
  if (stat.value !== undefined && stat.value !== null) {
    const val = parseFloat(stat.value);
    if (!isNaN(val)) return val;
  }
  const displayVal = stat.displayValue;
  if (displayVal === undefined || displayVal === null) return 0;

  const strVal = String(displayVal).trim();
  if (strVal.includes('-')) {
    const parts = strVal.split('-');
    const val = parseFloat(parts[0]);
    if (!isNaN(val)) return val;
  }
  if (strVal.includes(':')) {
    const parts = strVal.split(':');
    const mins = parseFloat(parts[0]) || 0;
    const secs = parseFloat(parts[1]) || 0;
    return mins * 60 + secs;
  }
  const val = parseFloat(strVal.replace(/%/g, ''));
  if (!isNaN(val)) return val;

  return 0;
}

function renderSingleStatRow(awayStat, homeStat) {
  if (!awayStat && !homeStat) return '';
  const label = awayStat?.label || awayStat?.displayName || awayStat?.shortDisplayName || awayStat?.abbreviation || awayStat?.name || homeStat?.label || homeStat?.displayName || homeStat?.shortDisplayName || homeStat?.abbreviation || homeStat?.name || '';
  const awayVal = awayStat ? (awayStat.displayValue ?? awayStat.value ?? '—') : '—';
  const homeVal = homeStat ? (homeStat.displayValue ?? homeStat.value ?? '—') : '—';

  const awayNum = getStatNumericValue(awayStat);
  const homeNum = getStatNumericValue(homeStat);
  const total = awayNum + homeNum;

  let awayPct = 0;
  let homePct = 0;
  if (total > 0) {
    awayPct = Math.round((awayNum / total) * 100);
    homePct = Math.round((homeNum / total) * 100);
  }

  return `
    <div class="stat-row">
      <span class="stat-val left">${escapeHtml(String(awayVal))}</span>
      <div class="stat-bar-container">
        <div class="stat-bar-label">${escapeHtml(label)}</div>
        <div class="stat-bar-track">
          <div class="stat-bar away-bar" style="width: ${awayPct}%"></div>
          <div class="stat-bar home-bar" style="width: ${homePct}%"></div>
        </div>
      </div>
      <span class="stat-val right">${escapeHtml(String(homeVal))}</span>
    </div>`;
}

// ── Leaders Rendering ─────────────────────────────────────

function renderLeaders(game, detail) {
  const leaders = detail.leaders || [];
  if (leaders.length === 0) return '<div class="detail-empty">Leaders not available</div>';

  let html = '';

  for (const category of leaders) {
    const catName = category.name || category.displayName || '';
    const catLabel = category.displayName || catName;

    html += `<div class="leaders-category">
      <div class="leaders-category-title">${escapeHtml(catLabel)}</div>
      <div class="leaders-row">`;

    const leaderEntries = category.leaders || [];
    for (const entry of leaderEntries) {
      const athlete = entry.athlete || entry.leaders?.[0]?.athlete || {};
      const stats = entry.displayValue || entry.leaders?.[0]?.displayValue || '';
      const team = entry.team || athlete.team || {};
      const headshot = athlete.headshot || athlete.headshot?.href || '';
      const name = athlete.displayName || athlete.shortName || '';
      const pos = athlete.position?.abbreviation || '';

      html += `
        <div class="leader-card">
          <div class="leader-headshot-wrap">
            ${headshot ? `<img src="${typeof headshot === 'string' ? headshot : headshot.href || ''}" class="leader-headshot" alt="" />` : `<div class="leader-headshot-placeholder">👤</div>`}
          </div>
          <span class="leader-name">${escapeHtml(name)}</span>
          <span class="leader-pos">${escapeHtml(pos)} · ${escapeHtml(team.abbreviation || '')}</span>
          <span class="leader-stat">${escapeHtml(stats)}</span>
        </div>`;
    }

    html += `</div></div>`;
  }

  return html;
}

// ── Scoring Plays ─────────────────────────────────────────

function renderScoringPlays(game, detail) {
  const scoringPlays = detail.scoringPlays || [];
  const drives = detail.drives || null;

  // For some sports, scoring plays are directly available
  if (scoringPlays.length > 0) {
    return renderScoringPlaysList(scoringPlays, game);
  }

  // For NFL, scoring may be in drives
  if (drives?.previous) {
    const scoringDrives = drives.previous.filter(d =>
      d.result?.name === 'TOUCHDOWN' || d.result?.name === 'FIELD_GOAL' ||
      d.result?.name === 'SAFETY' || d.result?.name === 'PAT'
    );
    if (scoringDrives.length > 0) {
      return renderScoringDrives(scoringDrives, game);
    }
  }

  // Try to extract from plays
  const allPlays = detail.plays || [];
  const scoring = allPlays.filter(p => p.scoringPlay || p.scoreValue > 0);
  if (scoring.length > 0) {
    return renderScoringPlaysList(scoring, game);
  }

  return '<div class="detail-empty">Scoring plays not available</div>';
}

function renderScoringPlaysList(plays, game) {
  let html = '<div class="scoring-plays-list">';
  let currentPeriod = null;

  for (const play of plays) {
    const period = play.period?.number || play.period || null;
    const periodLabel = getPeriodLabelSingle(game.league, period);

    if (period !== currentPeriod && periodLabel) {
      currentPeriod = period;
      html += `<div class="scoring-period-header">${escapeHtml(periodLabel)}</div>`;
    }

    const team = play.team || {};
    const teamLogo = team.logo || '';
    const teamAbbr = team.abbreviation || '';
    const text = play.text || play.type?.text || play.shortText || '';
    const awayScore = play.awayScore ?? '';
    const homeScore = play.homeScore ?? '';
    const clock = play.clock?.displayValue || play.displayClock || '';

    html += `
      <div class="scoring-play">
        <div class="scoring-play-team">
          ${teamLogo ? `<img src="${teamLogo}" class="scoring-play-logo" alt="" />` : ''}
          <span class="scoring-play-abbr">${escapeHtml(teamAbbr)}</span>
        </div>
        <div class="scoring-play-detail">
          <p class="scoring-play-text">${escapeHtml(text)}</p>
          ${clock ? `<span class="scoring-play-clock">${escapeHtml(clock)}</span>` : ''}
        </div>
        <div class="scoring-play-score">${awayScore} - ${homeScore}</div>
      </div>`;
  }

  html += '</div>';
  return html;
}

function renderScoringDrives(drives, game) {
  let html = '<div class="scoring-plays-list">';
  for (const drive of drives) {
    const team = drive.team || {};
    const result = drive.result?.name || '';
    const desc = drive.description || drive.result?.description || result;
    const plays = drive.plays || [];
    const lastPlay = plays[plays.length - 1];
    const clock = lastPlay?.clock?.displayValue || '';
    const period = lastPlay?.period?.number || '';

    html += `
      <div class="scoring-play">
        <div class="scoring-play-team">
          ${team.logo ? `<img src="${team.logo}" class="scoring-play-logo" alt="" />` : ''}
          <span class="scoring-play-abbr">${escapeHtml(team.abbreviation || '')}</span>
        </div>
        <div class="scoring-play-detail">
          <p class="scoring-play-text">${escapeHtml(desc)}</p>
          ${clock ? `<span class="scoring-play-clock">Q${period} ${clock}</span>` : ''}
        </div>
      </div>`;
  }
  html += '</div>';
  return html;
}

function getPeriodLabelSingle(league, period) {
  if (!period) return '';
  if (league === 'mlb') return `Inning ${period}`;
  return `Quarter ${period}`;
}

// ── Game Info Footer ──────────────────────────────────────

function renderGameInfo(game, detail) {
  const gameInfo = detail.gameInfo || {};
  const venue = gameInfo.venue || {};
  const weather = detail.weather || gameInfo.weather || null;
  const odds = detail.odds || [];

  let html = '<div class="game-info-footer">';

  // Venue
  if (venue.fullName) {
    html += `<div class="info-row">
      <span class="info-label">Venue</span>
      <span class="info-value">${escapeHtml(venue.fullName)}${venue.address?.city ? ', ' + escapeHtml(venue.address.city) : ''}</span>
    </div>`;
  }

  // Attendance
  if (gameInfo.attendance) {
    html += `<div class="info-row">
      <span class="info-label">Attendance</span>
      <span class="info-value">${Number(gameInfo.attendance).toLocaleString()}</span>
    </div>`;
  }

  // Weather
  if (weather) {
    html += `<div class="info-row">
      <span class="info-label">Weather</span>
      <span class="info-value">${escapeHtml(weather.displayValue || weather.conditionId || '')}${weather.temperature ? ', ' + weather.temperature + '°F' : ''}</span>
    </div>`;
  }

  // Odds
  if (odds.length > 0) {
    const o = odds[0];
    html += `<div class="info-row">
      <span class="info-label">Odds</span>
      <span class="info-value">${escapeHtml(o.details || '')}${o.overUnder ? ' · O/U ' + o.overUnder : ''}</span>
    </div>`;
  }

  html += '</div>';
  return html;
}

// ── Team Search & Filter ──────────────────────────────────

function clearTeamFilter() {
  state.teamFilter = null;
  render();
}

async function fetchSearchTeams() {
  if (state.allTeamsLoaded || state.allTeamsLoading) return;
  state.allTeamsLoading = true;
  state.allTeamsError = null;
  renderSearchResults();

  try {
    const allTeams = [];
    const results = await Promise.allSettled(
      LEAGUES.map(async (l) => {
        const url = `${BASE_URL}/${l.sport}/${l.league}/teams?limit=1000`;
        let teamsList = [];

        if (window.__TAURI__) {
          try {
            const rawData = await window.__TAURI__.core.invoke("fetch_teams_native", { sport: l.sport, league: l.league });
            const data = JSON.parse(rawData);
            teamsList = data.sports?.[0]?.leagues?.[0]?.teams || [];
          } catch (err) {
            console.warn(`Native fetch failed for ${l.label}, falling back to web fetch:`, err);
            const res = await fetch(url);
            if (!res.ok) throw new Error(`${l.label}: ${res.status}`);
            const data = await res.json();
            teamsList = data.sports?.[0]?.leagues?.[0]?.teams || [];
          }
        } else {
          const res = await fetch(url);
          if (!res.ok) throw new Error(`${l.label}: ${res.status}`);
          const data = await res.json();
          teamsList = data.sports?.[0]?.leagues?.[0]?.teams || [];
        }

        return teamsList.map(t => ({
          id: t.team?.id || '',
          name: t.team?.displayName || t.team?.name || '',
          abbr: t.team?.abbreviation || '',
          logo: t.team?.logos?.[0]?.href || '',
          color: t.team?.color || '333333',
          sport: l.sport,
          league: l.league,
          leagueKey: l.key,
          leagueLabel: l.label,
          leagueIcon: l.icon
        }));
      })
    );

    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        allTeams.push(...r.value);
      } else {
        console.warn(`Failed to fetch teams for ${LEAGUES[idx].label}:`, r.reason);
      }
    });

    state.allTeams = allTeams;
    state.allTeamsLoaded = true;
    state.allTeamsLoading = false;
  } catch (err) {
    state.allTeamsLoading = false;
    state.allTeamsError = err.message;
  }

  renderSearchResults();
}

function openSearchModal() {
  let modal = document.getElementById('search-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'search-modal';
    document.getElementById('app').appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-overlay" id="search-modal-overlay">
      <div class="modal-sheet" id="search-modal-sheet" style="max-height: 85vh; display: flex; flex-direction: column;">
        <div class="modal-header-bg" style="padding: 16px 20px; border-bottom: 1px solid var(--border-card); display: flex; flex-direction: column; gap: 12px; background: var(--bg-header); position: relative; border-radius: var(--radius-lg) var(--radius-lg) 0 0;">
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <h2 style="margin: 0; font-size: 20px; font-weight: 800; color: #fff;">Search Teams</h2>
            <button class="modal-close" id="search-modal-close-btn" style="position: static; background: none; border: none; color: var(--text-secondary); font-size: 20px; cursor: pointer;">✕</button>
          </div>
          <div class="search-input-wrapper" style="position: relative; display: flex; align-items: center; width: 100%;">
            <svg class="search-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="position: absolute; left: 12px; color: var(--text-muted); pointer-events: none;">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="text" id="search-input" placeholder="Search teams, cities, or abbreviations..." style="width: 100%; padding: 10px 12px 10px 40px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-card); border-radius: var(--radius-sm); color: #fff; font-family: var(--font); font-size: 14px; outline: none; transition: border-color 0.2s;" />
            <button id="search-clear-btn" style="position: absolute; right: 12px; background: none; border: none; color: var(--text-muted); cursor: pointer; display: none; font-size: 14px; padding: 4px;">✕</button>
          </div>
        </div>
        <div class="modal-body" id="search-modal-body" style="padding: 0; flex: 1; overflow-y: auto;">
          <!-- Search results render here -->
        </div>
      </div>
    </div>`;

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Bind close events
  document.getElementById('search-modal-close-btn').addEventListener('click', closeSearchModal);
  document.getElementById('search-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'search-modal-overlay') closeSearchModal();
  });

  const searchInput = document.getElementById('search-input');
  const searchClearBtn = document.getElementById('search-clear-btn');

  // Input event listener
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim();
    if (state.searchQuery) {
      searchClearBtn.style.display = 'block';
    } else {
      searchClearBtn.style.display = 'none';
    }
    renderSearchResults();
  });

  // Clear button click
  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.searchQuery = '';
    searchClearBtn.style.display = 'none';
    searchInput.focus();
    renderSearchResults();
  });

  // Set active search toggle state
  document.getElementById('search-toggle')?.classList.add('active');

  // Trigger loading teams
  fetchSearchTeams();

  // Focus input
  setTimeout(() => { searchInput.focus(); }, 100);
}

function closeSearchModal() {
  const modal = document.getElementById('search-modal');
  if (modal) {
    modal.classList.remove('open');
    document.getElementById('search-toggle')?.classList.remove('active');
    
    // Only clear body overflow if game detail modal is not open
    if (!document.getElementById('game-detail-modal')?.classList.contains('open') &&
        !document.getElementById('team-detail-modal')?.classList.contains('open')) {
      document.body.style.overflow = '';
    }
    setTimeout(() => { 
      modal.innerHTML = ''; 
      state.searchQuery = '';
    }, 300);
  }
}

function renderSearchResults() {
  const bodyEl = document.getElementById('search-modal-body');
  if (!bodyEl) return;

  if (state.allTeamsLoading) {
    bodyEl.innerHTML = `
      <div class="search-loading-container">
        <div class="spinner"></div>
        <p>Loading teams...</p>
      </div>`;
    return;
  }

  if (state.allTeamsError) {
    bodyEl.innerHTML = `
      <div class="search-empty-state">
        <div style="font-size: 24px; margin-bottom: 8px;">⚠️</div>
        <h3>Failed to load teams</h3>
        <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 12px;">${escapeHtml(state.allTeamsError)}</p>
        <button class="clear-filter-btn" onclick="fetchSearchTeams()">Retry</button>
      </div>`;
    return;
  }

  // Filter teams based on search query
  const query = state.searchQuery.toLowerCase();
  let filtered = state.allTeams;
  
  if (query) {
    filtered = state.allTeams.filter(t => 
      t.name.toLowerCase().includes(query) || 
      t.abbr.toLowerCase().includes(query)
    );
  }

  if (filtered.length === 0) {
    bodyEl.innerHTML = `
      <div class="search-empty-state">
        <div style="font-size: 24px; margin-bottom: 8px;">🔍</div>
        <h3>No teams found</h3>
        <p style="color: var(--text-muted); font-size: 13px;">Try searching for city name or abbreviation</p>
      </div>`;
    return;
  }

  // Render list of teams
  let html = '<div class="search-results-list">';
  filtered.forEach(team => {
    const isFav = state.favorites.includes(team.abbr);
    html += `
      <div class="search-team-item" data-team-id="${team.id}" data-league-key="${team.leagueKey}">
        <div class="search-team-left">
          ${team.logo ? `<img class="search-team-logo" src="${escapeHtml(team.logo)}" alt="" loading="lazy" />` : '<div class="search-team-logo" style="display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.05); border-radius: var(--radius-sm); font-size: 12px;">🏆</div>'}
          <div class="search-team-info">
            <div class="search-team-name-row">
              <span class="search-team-name">${escapeHtml(team.name)}</span>
              <span class="search-team-abbr">${escapeHtml(team.abbr)}</span>
            </div>
            <span class="search-team-meta">${team.leagueIcon} ${escapeHtml(team.leagueLabel)}</span>
          </div>
        </div>
        <div class="search-team-right">
          <div class="search-item-actions">
            <button class="search-fav-btn${isFav ? ' is-favorite' : ''}" data-fav-abbr="${escapeHtml(team.abbr)}" title="Toggle Favorite">
              ${isFav ? '⭐' : '☆'}
            </button>
            <button class="search-info-btn" data-team-id="${team.id}" data-sport="${team.sport}" data-league="${team.league}" title="View Stats">
              📊
            </button>
          </div>
        </div>
      </div>`;
  });
  html += '</div>';

  bodyEl.innerHTML = html;

  // Bind click handlers to the team cards to filter games
  bodyEl.querySelectorAll('.search-team-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // If favorite star or stats button is clicked, do not select team
      if (e.target.closest('.search-fav-btn') || e.target.closest('.search-info-btn')) {
        return;
      }
      const teamId = item.dataset.teamId;
      const leagueKey = item.dataset.leagueKey;
      const selected = state.allTeams.find(t => t.id === teamId && t.leagueKey === leagueKey);
      if (selected) {
        state.teamFilter = selected;
        render();
        closeSearchModal();
      }
    });
  });

  // Bind favorite button click
  bodyEl.querySelectorAll('.search-fav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const abbr = btn.dataset.favAbbr;
      toggleFavorite(abbr);
      // Re-render search results to update star states in the open modal
      renderSearchResults();
    });
  });

  // Bind view stats button click
  bodyEl.querySelectorAll('.search-info-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const teamId = btn.dataset.teamId;
      const sport = btn.dataset.sport;
      const league = btn.dataset.league;
      openTeamDetail(teamId, sport, league);
    });
  });
}

// ── Event Listeners ───────────────────────────────────────

function initListeners() {
  // Date tabs
  document.querySelectorAll('.date-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.date-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.dateOffset = parseInt(tab.dataset.offset, 10);
      fetchAllLeagues();
    });
  });

  // Sport filter pills
  document.querySelectorAll('.sport-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.sport-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.leagueFilter = pill.dataset.league;
      if (state.showStandings) {
        fetchStandingsData();
      } else {
        render();
      }
    });
  });

  // Global click delegate (game cards, standings, teams, external links)
  document.addEventListener('click', (e) => {
    // Toggle My Teams collapse
    const myTeamsHeader = e.target.closest('#my-teams-header');
    if (myTeamsHeader) {
      e.stopPropagation();
      const currentCollapsed = state.myTeamsCollapsed !== null ? state.myTeamsCollapsed : (state.dateOffset === 1);
      state.myTeamsCollapsed = !currentCollapsed;
      render();
      return;
    }
    // Clickable external link
    const extLink = e.target.closest('.external-link');
    if (extLink) {
      e.preventDefault();
      const url = extLink.dataset.url;
      if (url) {
        if (window.__TAURI__) {
          window.__TAURI__.core.invoke("open_url", { url });
        } else {
          window.open(url, '_blank');
        }
      }
      return;
    }
    // Favorite star toggle
    const star = e.target.closest('.fav-star');
    if (star) {
      e.stopPropagation();
      toggleFavorite(star.dataset.favAbbr);
      return;
    }
    // Clickable team to view stats
    const teamClickable = e.target.closest('.team-clickable');
    if (teamClickable) {
      e.stopPropagation();
      const teamId = teamClickable.dataset.teamId;
      const sport = teamClickable.dataset.sport;
      const league = teamClickable.dataset.league;
      openTeamDetail(teamId, sport, league);
      return;
    }
    const card = e.target.closest('.game-card');
    if (card) {
      openGameDetail(card.dataset.gameId);
    }
  });

  // Search toggle
  document.getElementById('search-toggle')?.addEventListener('click', () => {
    const btn = document.getElementById('search-toggle');
    if (btn?.classList.contains('active')) {
      closeSearchModal();
    } else {
      openSearchModal();
    }
  });

  // Standings toggle
  document.getElementById('standings-toggle')?.addEventListener('click', () => {
    const btn = document.getElementById('standings-toggle');
    state.showStandings = !state.showStandings;
    if (state.showStandings) {
      btn?.classList.add('active');
      document.querySelector('.date-tabs')?.setAttribute('style', 'display: none;');
      fetchStandingsData();
    } else {
      btn?.classList.remove('active');
      document.querySelector('.date-tabs')?.removeAttribute('style');
      fetchAllLeagues();
    }
  });

  // Refresh button
  document.getElementById('refresh-btn')?.addEventListener('click', () => {
    const btn = document.getElementById('refresh-btn');
    btn?.classList.add('spinning');
    const refreshPromise = state.showStandings ? fetchStandingsData() : fetchAllLeagues();
    refreshPromise.finally(() => {
      btn?.classList.remove('spinning');
    });
  });

  // ESC to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeTeamModal();
      closeSearchModal();
    }
  });

  // Enable mouse wheel horizontal scrolling on the sport-filters bar
  const filtersBar = document.querySelector('.sport-filters');
  if (filtersBar) {
    filtersBar.addEventListener('wheel', (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        filtersBar.scrollLeft += e.deltaY;
      }
    }, { passive: false });
  }
}

// ── Auto-refresh ──────────────────────────────────────────

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (state.dateOffset === 0) {
      if (state.showStandings) {
        fetchStandingsData();
      } else {
        fetchAllLeagues();
      }
    }
  }, 30_000);
}

// ── Init ──────────────────────────────────────────────────

initListeners();
fetchAllLeagues();
startAutoRefresh();
