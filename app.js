const filter = document.querySelector('#filter');
const episodeFilter = document.querySelector('#episode-filter');
const episodeFilterWrap = document.querySelector('#episode-filter-wrap');
const list = document.querySelector('#list');
const detail = document.querySelector('#detail');
const travelForm = document.querySelector('#travel-form');
const travelScroll = document.querySelector('#travel-scroll');
const travelView = document.querySelector('#view-travel');
const travelStops = document.querySelector('#travel-stops');
const travelAddStop = document.querySelector('#travel-add-stop');
const travelMode = document.querySelector('#travel-mode');
const travelRadius = document.querySelector('#travel-radius');
const travelStatus = document.querySelector('#travel-status');
const travelClearResults = document.querySelector('#travel-clear-results');
const nearbyForm = document.querySelector('#nearby-form');
const nearbyQuery = document.querySelector('#nearby-query');
const nearbyRadius = document.querySelector('#nearby-radius');
const nearbyChoice = document.querySelector('#nearby-choice');
const nearbyChoiceLabel = document.querySelector('#nearby-choice-label');
const nearbyClear = document.querySelector('#nearby-clear');
const nearbyStatus = document.querySelector('#nearby-status');
const nearbySubmit = nearbyForm.querySelector('button[type="submit"]');
const geocodingCache = new Map();
let activeView = 'explore';
let mode = 'work';
let selected = null;
let nearby = null;
let searchRequest = 0;
let map;
let layer;
let routeLayer;
let travelCandidates = null;
let plannedRoute = null;
let plannedStops = [];
let travelRevision = 0;
const worksWithSeasons = new Set(places.filter(place => /\d+기/.test(place[8] || '')).map(place => place[3]));

function makeIcon(...paths) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  for (const [name, value] of Object.entries({
    width: '24', height: '24', viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'
  })) svg.setAttribute(name, value);
  for (const data of paths) {
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', data);
    svg.append(path);
  }
  return svg;
}

function romanizeJapaneseName(query) {
  const station = /역\s*$/.test(query);
  const text = station ? query.replace(/\s*역\s*$/, '') : query;
  const consonants = ['k', 'kk', 'n', 't', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h'];
  const vowels = ['a', 'e', 'ya', 'ye', 'o', 'e', 'yo', 'ye', 'o', 'wa', 'we', 'we', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'u', 'ui', 'i'];
  const finals = ['', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'r', 'k', 'm', 'p', 'r', 'r', 'p', 'r', 'm', 'p', 'p', 't', 't', 'n', 't', 't', 'k', 't', 'p', 't'];
  const name = [...text].map(character => {
    const code = character.charCodeAt(0) - 0xac00;
    if (code < 0 || code >= 11172) return character;
    const initial = Math.floor(code / 588);
    const vowel = Math.floor(code % 588 / 28);
    const final = code % 28;
    let sound = consonants[initial] + vowels[vowel];
    if (vowel === 20 && initial === 9) sound = 'shi';
    if (vowel === 20 && initial === 12) sound = 'ji';
    if (vowel === 20 && initial === 14) sound = 'chi';
    if (vowel === 18 && initial === 12) sound = 'zu';
    if (vowel === 18 && initial === 14) sound = 'tsu';
    return sound + finals[final];
  }).join('').trim();
  return {name, station};
}

async function searchPlaces(query) {
  const normalizedQuery = query.toLowerCase().replace(/\s+/g, '');
  const local = locationGroups.flatMap(group => {
    const place = group.find(item => hasCoordinates(item) &&
      [item[0], item[1]].some(name => name.toLowerCase().replace(/\s+/g, '').includes(normalizedQuery)));
    return place ? [{name: place[0], label: `${place[0]} (${place[1]}, ${place[2]})`,
      lat: place[4], lng: place[5],
      exact: [place[0], place[1]].some(name => name.toLowerCase().replace(/\s+/g, '') === normalizedQuery)}] : [];
  }).slice(0, 8);
  let remote = geocodingCache.get(query);
  if (!remote) {
    try {
      const photon = async (text, station = false) => {
        const params = new URLSearchParams({q: text, limit: '8', lat: '36', lon: '138'});
        if (station) params.set('osm_tag', 'railway:station');
        const response = await fetch(`https://photon.komoot.io/api/?${params}`);
        if (!response.ok) throw new Error('geocoding');
        return (await response.json()).features.filter(feature =>
          feature.geometry?.type === 'Point' &&
          feature.geometry.coordinates.length >= 2 &&
          feature.geometry.coordinates.slice(0, 2).every(Number.isFinite)
        ).map(feature => {
          const properties = feature.properties;
          const name = properties.name || text;
          const label = station && !/(駅|station)$/i.test(name) ? `${name} (역)` : name;
          return {
            name: label,
            label: [...new Set([label, properties.city, properties.state, properties.country].filter(Boolean))].join(', '),
            lat: feature.geometry.coordinates[1],
            lng: feature.geometry.coordinates[0]
          };
        });
      };
      remote = await photon(query);
      if (!remote.length && /[가-힣]/.test(query)) {
        const translated = romanizeJapaneseName(query);
        if (translated.name) remote = await photon(translated.name, translated.station);
      }
      geocodingCache.set(query, remote);
    } catch (error) {
      if (!local.length) throw error;
      remote = [];
    }
  }
  return [...local.filter(result => result.exact), ...remote, ...local.filter(result => !result.exact)];
}

function setupFilters() {
  const index = mode === 'work' ? 3 : 2;
  const values = [...new Set(places.map(place => place[index]))];
  filter.replaceChildren(new Option(mode === 'work' ? '모든 작품' : '모든 지역', ''), ...values.map(value => new Option(value, value)));
  filter.value = '';
  setupEpisodes();
  render();
}

function episodeOptions(place, hasSeasons) {
  if (!place[8]) return [];
  let season = hasSeasons ? 1 : null;
  const labels = [];
  const text = place[8].replace(/(\d+)(?=\s*,\s*\d+\s*화)/g, '$1화');
  for (const part of text.split(/[,，、]/)) {
    const seasonMatch = part.match(/(\d+)기/);
    if (seasonMatch) season = Number(seasonMatch[1]);
    const prefix = season ? `${season}기 ` : '';
    const number = part.match(/(\d+)화/);
    if (number) labels.push(`${prefix}${Number(number[1])}화`);
    const cour = part.match(/(\d+)쿨/);
    if (part.includes('오프닝')) labels.push(cour ? `${cour[1]}쿨 오프닝` : `${prefix}오프닝`);
    if (part.includes('엔딩')) labels.push(`${prefix}엔딩`);
    const movie = part.match(/극장판\s*(?:전편|후편)/);
    if (movie) labels.push(movie[0]);
  }
  return labels;
}

function setupEpisodes() {
  const workPlaces = mode === 'work' && filter.value
    ? places.filter(place => place[3] === filter.value) : [];
  const hasSeasons = worksWithSeasons.has(filter.value);
  const options = [...new Set(workPlaces.flatMap(place => episodeOptions(place, hasSeasons)))];
  options.sort((a, b) => a.localeCompare(b, 'ko', {numeric: true}));
  episodeFilter.replaceChildren(new Option('모든 등장 화수', ''), ...options.map(value => new Option(value, value)));
  episodeFilterWrap.hidden = options.length === 0;
}

function matchesFilters(place) {
  if (activeView === 'travel') return true;
  const index = mode === 'work' ? 3 : 2;
  if (filter.value && place[index] !== filter.value) return false;
  if (nearby && (!hasCoordinates(place) || distanceKm(nearby.lat, nearby.lng, place[4], place[5]) > nearby.radius)) return false;
  if (episodeFilter.value) {
    const hasSeasons = worksWithSeasons.has(place[3]);
    if (!episodeOptions(place, hasSeasons).includes(episodeFilter.value)) return false;
  }
  return true;
}

function visiblePlaces() {
  if (activeView === 'travel' && !travelCandidates) return [];
  return locationGroups.filter(group => (activeView !== 'travel' || !travelCandidates || travelCandidates.has(group)) &&
    group.some(matchesFilters)).sort((a, b) => {
    if (activeView === 'travel' && travelCandidates) return travelCandidates.get(a).position - travelCandidates.get(b).position;
    if (!nearby) return 0;
    const distance = group => Math.min(...group.filter(matchesFilters).map(place =>
      distanceKm(nearby.lat, nearby.lng, place[4], place[5])
    ));
    return distance(a) - distance(b);
  });
}

function hasCoordinates(place) {
  return Number.isFinite(place[4]) && Number.isFinite(place[5]);
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const radians = Math.PI / 180;
  const dLat = (lat2 - lat1) * radians;
  const dLng = (lng2 - lng1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function representative(group) {
  return group.find(matchesFilters) || group[0];
}

function buildLocationGroups() {
  const groups = [];
  const normalize = name => name.replace(/[\s・·,、()（）]/g, '').toLowerCase();
  places.forEach(place => {
    const group = groups.find(items => items.some(item =>
      (place[9] && place[9] === item[9]) ||
      (place[3] !== item[3] && place[2] === item[2] && hasCoordinates(place) &&
        hasCoordinates(item) && normalize(place[1]) === normalize(item[1]) &&
        distanceKm(place[4], place[5], item[4], item[5]) <= 0.1)
    ));
    if (group) group.push(place);
    else groups.push([place]);
  });
  return groups;
}

const locationGroups = buildLocationGroups();
function renderTravelRoute() {
  if (!routeLayer) return;
  routeLayer.clearLayers();
  if (!plannedRoute) return;
  L.polyline(plannedRoute, {
    color: '#ff577b', weight: 4, opacity: .8, interactive: false
  }).addTo(routeLayer);
  plannedStops.forEach((stop, index) => {
    const marker = L.marker([stop.lat, stop.lng], {
      icon: L.divIcon({className: 'route-marker', html: String(index + 1), iconSize: [26, 26], iconAnchor: [13, 13]})
    });
    marker.bindTooltip(stop.name, {direction: 'top', offset: [0, -12]});
    marker.addTo(routeLayer);
  });
}

const travelRows = [];

function refreshTravelStops() {
  travelStops.replaceChildren(...travelRows.map((row, index) => {
    row.label.textContent = index === 0 ? '출발' :
      index === travelRows.length - 1 ? '도착' : `경유 ${index}`;
    row.up.setAttribute('aria-label', `${row.label.textContent} 위로 이동`);
    row.down.setAttribute('aria-label', `${row.label.textContent} 아래로 이동`);
    row.remove.setAttribute('aria-label', `${row.label.textContent} 삭제`);
    row.up.disabled = index === 0;
    row.down.disabled = index === travelRows.length - 1;
    row.remove.disabled = travelRows.length <= 2;
    return row.element;
  }));
  travelAddStop.disabled = travelRows.length >= 8;
}

function addTravelStop() {
  if (travelRows.length >= 8) return;
  travelRevision++;
  const element = document.createElement('div');
  element.className = 'travel-stop';
  const heading = document.createElement('div');
  heading.className = 'travel-stop-heading';
  const label = document.createElement('span');
  const up = document.createElement('button');
  const down = document.createElement('button');
  const remove = document.createElement('button');
  for (const button of [up, down, remove]) button.type = 'button';
  up.title = '위로 이동';
  down.title = '아래로 이동';
  remove.title = '삭제';
  up.append(makeIcon('m5 12 7-7 7 7', 'M12 19V5'));
  down.append(makeIcon('M12 5v14', 'm19 12-7 7-7-7'));
  remove.append(makeIcon('M18 6 6 18', 'm6 6 12 12'));
  heading.append(label, up, down, remove);
  const search = document.createElement('div');
  search.className = 'travel-search';
  const input = document.createElement('input');
  input.type = 'search'; input.placeholder = '장소 또는 주소';
  input.setAttribute('aria-label', '여행 장소 검색');
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = '검색';
  search.append(input, button);
  const choices = document.createElement('select');
  choices.hidden = true;
  choices.setAttribute('aria-label', '검색 결과 선택');
  const row = {element, label, input, up, down, remove, choices, selected: null, request: 0};
  element.append(heading, search, choices);
  if (travelRows.length < 2) travelRows.push(row);
  else travelRows.splice(travelRows.length - 1, 0, row);
  input.addEventListener('input', () => {
    row.request++;
    travelRevision++;
    row.selected = null;
    choices.hidden = true;
  });
  choices.addEventListener('change', () => {
    travelRevision++;
    row.selected = row.results?.[Number(choices.value) - 1] || null;
  });
  button.addEventListener('click', async () => {
    const query = input.value.trim();
    if (!query) { travelStatus.textContent = '검색할 장소를 입력하세요.'; return; }
    const request = ++row.request;
    travelRevision++;
    row.selected = null;
    button.disabled = true;
    travelStatus.textContent = '장소를 검색하고 있습니다.';
    try {
      const results = await searchPlaces(query);
      if (request !== row.request) return;
      row.results = results;
      if (!row.results.length) {
        choices.hidden = true;
        travelStatus.textContent = '검색 결과가 없습니다. 일본어 또는 영문 이름으로 검색하세요.';
        return;
      }
      choices.replaceChildren(new Option('검색 결과를 선택하세요', ''),
        ...row.results.map((result, index) => new Option(result.label, String(index + 1))));
      choices.value = '';
      choices.hidden = false;
      travelStatus.textContent = '검색 결과에서 장소를 선택하세요.';
    } catch {
      if (request === row.request) travelStatus.textContent = '장소를 검색하지 못했습니다. 다시 시도하세요.';
    } finally {
      button.disabled = false;
    }
  });
  for (const [control, offset] of [[up, -1], [down, 1]]) {
    control.addEventListener('click', () => {
      const index = travelRows.indexOf(row);
      if (index + offset < 0 || index + offset >= travelRows.length) return;
      [travelRows[index], travelRows[index + offset]] = [travelRows[index + offset], travelRows[index]];
      travelRevision++;
      refreshTravelStops();
    });
  }
  remove.addEventListener('click', () => {
    if (travelRows.length <= 2) return;
    row.request++;
    travelRevision++;
    travelRows.splice(travelRows.indexOf(row), 1);
    refreshTravelStops();
  });
  refreshTravelStops();
}

travelAddStop.addEventListener('click', addTravelStop);
addTravelStop();
addTravelStop();
travelMode.addEventListener('change', () => { travelRevision++; });
travelRadius.addEventListener('input', () => { travelRevision++; });

async function findRoadRoute(start, end, costing) {
  const request = {
    locations: [{lat: start.lat, lon: start.lng}, {lat: end.lat, lon: end.lng}],
    costing, format: 'osrm', shape_format: 'geojson'
  };
  const params = new URLSearchParams({json: JSON.stringify(request)});
  const response = await fetch(`https://valhalla1.openstreetmap.de/route?${params}`);
  if (!response.ok) throw new Error('routing');
  const data = await response.json();
  const coordinates = data.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2 ||
      coordinates.some(point => !Array.isArray(point) || point.length < 2 || !point.slice(0, 2).every(Number.isFinite))) {
    throw new Error('routing');
  }
  return coordinates.map(([lng, lat]) => [lat, lng]);
}

function closestOnRoute(place, route) {
  const latScale = 111.195;
  const lonScale = latScale * Math.cos(place[4] * Math.PI / 180);
  let best = {distance: Infinity, position: 0};
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const ax = (a[1] - place[5]) * lonScale, ay = (a[0] - place[4]) * latScale;
    const dx = (b[1] - a[1]) * lonScale, dy = (b[0] - a[0]) * latScale;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length)) : 0;
    const distance = Math.hypot(ax + t * dx, ay + t * dy);
    if (distance < best.distance) best = {distance, position: (i + t) / (route.length - 1)};
  }
  return best;
}

travelForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!travelForm.reportValidity()) return;
  const stops = travelRows.map(row => row.selected);
  if (stops.some(stop => !stop)) {
    travelStatus.textContent = '각 장소를 검색한 뒤 결과에서 선택하세요.';
    return;
  }
  if (stops.some((stop, index) => index && distanceKm(stop.lat, stop.lng,
    stops[index - 1].lat, stops[index - 1].lng) < .01)) {
    travelStatus.textContent = '연속된 장소가 같습니다. 다른 장소를 선택하세요.';
    return;
  }
  const submit = travelForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  travelStatus.textContent = '경로와 주변 성지를 찾고 있습니다.';
  const revision = travelRevision;
  try {
    const legs = await Promise.all(stops.slice(1).map((stop, index) =>
      findRoadRoute(stops[index], stop, travelMode.value)));
    if (revision !== travelRevision) {
      travelStatus.textContent = '장소나 설정이 변경되었습니다. 경로를 다시 검색하세요.';
      return;
    }
    const matches = [];
    for (const group of locationGroups) {
      const place = group.find(hasCoordinates);
      if (!place) continue;
      let closest = {distance: Infinity, position: 0, leg: 0};
      legs.forEach((leg, index) => {
        const point = closestOnRoute(place, leg);
        if (point.distance < closest.distance) closest = {...point, leg: index};
      });
      if (closest.distance <= travelRadius.valueAsNumber) {
        matches.push({group, ...closest, position: closest.leg + closest.position});
      }
    }
    plannedRoute = legs.flatMap((leg, index) => index ? leg.slice(1) : leg);
    plannedStops = stops;
    travelCandidates = new Map(matches.map(result => [result.group, result]));
    travelClearResults.hidden = false;
    renderTravelRoute();
    render();
    if (activeView === 'travel' && map) map.fitBounds(L.latLngBounds(plannedRoute), {padding: [45, 45], maxZoom: 14});
    travelStatus.textContent = `경로 주변 ${travelRadius.valueAsNumber}km 이내에 성지 ${matches.length}곳이 있습니다.`;
  } catch {
    travelStatus.textContent = '경로를 찾지 못했습니다. 장소나 이동 수단을 바꿔 다시 시도하세요.';
  } finally {
    submit.disabled = false;
  }
});

travelClearResults.addEventListener('click', () => {
  travelRevision++;
  travelCandidates = null;
  plannedRoute = null;
  plannedStops = [];
  renderTravelRoute();
  travelClearResults.hidden = true;
  travelStatus.textContent = '';
  render();
});

function setNearbyLocation() {
  const option = nearbyChoice.selectedOptions[0];
  const radius = nearbyRadius.valueAsNumber;
  if (!option || !Number.isFinite(radius) || radius <= 0 || !nearbyRadius.checkValidity()) return;
  nearby = {
    name: option.textContent,
    lat: Number(option.dataset.lat),
    lng: Number(option.dataset.lng),
    radius
  };
  nearbyClear.hidden = false;
  render();
}

nearbyForm.addEventListener('submit', async event => {
  event.preventDefault();
  const query = nearbyQuery.value.trim();
  if (!query || !nearbyForm.reportValidity()) return;
  const request = ++searchRequest;
  nearby = null;
  nearbyChoice.hidden = true;
  nearbyChoiceLabel.hidden = true;
  nearbyClear.hidden = false;
  nearbySubmit.disabled = true;
  nearbyStatus.textContent = '장소를 검색하고 있습니다.';
  render();
  try {
    const results = await searchPlaces(query);
    if (request !== searchRequest) return;
    if (!results.length) {
      nearbyStatus.textContent = '검색 결과가 없습니다. 일본어 또는 영문 이름으로 검색하세요.';
      return;
    }
    nearbyChoice.replaceChildren(...results.map(result => {
      const option = new Option(result.label, '');
      option.dataset.lat = result.lat;
      option.dataset.lng = result.lng;
      return option;
    }));
    nearbyChoice.hidden = results.length < 2;
    nearbyChoiceLabel.hidden = results.length < 2;
    setNearbyLocation();
  } catch {
    if (request === searchRequest) nearbyStatus.textContent = '장소를 검색하지 못했습니다. 잠시 후 다시 시도하세요.';
  } finally {
    if (request === searchRequest) nearbySubmit.disabled = false;
  }
});

nearbyChoice.addEventListener('change', setNearbyLocation);
nearbyRadius.addEventListener('change', () => {
  if (nearby) setNearbyLocation();
});
nearbyClear.addEventListener('click', () => {
  searchRequest++;
  nearby = null;
  nearbyQuery.value = '';
  nearbyChoice.replaceChildren();
  nearbyChoice.hidden = true;
  nearbyChoiceLabel.hidden = true;
  nearbyClear.hidden = true;
  nearbySubmit.disabled = false;
  nearbyStatus.textContent = '';
  render();
});

function createGallery(name, work, imageNames) {
  const gallery = document.createElement('div');
  gallery.className = 'gallery'; gallery.hidden = true;
  const scenes = document.createElement('div');
  scenes.className = 'scenes';
  scenes.setAttribute('aria-label', `${work}, ${name}의 작품 장면`);
  const controls = document.createElement('div');
  controls.className = 'scene-controls'; controls.hidden = true;
  const previous = document.createElement('button');
  previous.type = 'button'; previous.setAttribute('aria-label', '이전 이미지');
  previous.append(makeIcon('m15 18-6-6 6-6'));
  const next = document.createElement('button');
  next.type = 'button'; next.setAttribute('aria-label', '다음 이미지');
  next.append(makeIcon('m9 18 6-6-6-6'));
  previous.addEventListener('click', () => scenes.scrollBy({ left: -scenes.clientWidth }));
  next.addEventListener('click', () => scenes.scrollBy({ left: scenes.clientWidth }));
  controls.append(previous, next);
  gallery.append(scenes, controls);
  let loaded = 0;
  imageNames.forEach((imageName, index) => {
    const image = document.createElement('img');
    image.className = 'scene'; image.alt = `${work}, ${name}의 작품 장면 ${index + 1}`; image.hidden = true;
    image.addEventListener('load', () => {
      image.hidden = false; gallery.hidden = false;
      loaded += 1; controls.hidden = loaded < 2;
    }, { once: true });
    scenes.append(image);
    image.src = `images/scenes/${imageName}.webp`;
  });
  return gallery;
}

function showPlace(group, place = representative(group)) {
  selected = group;
  const [name, japanese, region, , lat, lng] = place;
  detail.replaceChildren();
  const close = document.createElement('button');
  close.className = 'close'; close.type = 'button'; close.setAttribute('aria-label', '장소 정보 닫기');
  close.append(makeIcon('M18 6 6 18', 'm6 6 12 12'));
  close.addEventListener('click', () => { detail.hidden = true; selected = null; renderList(); });

  const works = [...new Set(group.map(item => item[3]))];
  const tags = document.createElement('div'); tags.className = 'work-tags';
  works.forEach(work => {
    const tag = document.createElement('span'); tag.className = 'work'; tag.textContent = work;
    tags.append(tag);
  });
  const title = document.createElement('h2'); title.textContent = name;
  const jp = document.createElement('p'); jp.className = 'jp'; jp.textContent = `${japanese} / ${region}`;
  detail.append(close, tags, title, jp);

  const episodeLabels = works.flatMap(work => {
    const episodes = [...new Set(group.filter(item => item[3] === work).map(item => item[8]).filter(Boolean))];
    if (!episodes.length) return [];
    const label = episodes.join(', ');
    return [works.length > 1 ? `${label}(${work})` : label];
  });
  if (episodeLabels.length) {
    const episodeInfo = document.createElement('p');
    episodeInfo.className = 'episode'; episodeInfo.textContent = `등장: ${episodeLabels.join(', ')}`;
    detail.append(episodeInfo);
  }

  works.forEach(work => {
    const items = group.filter(item => item[3] === work);
    const section = document.createElement('div'); section.className = 'detail-entry';
    const images = [...new Set(items.flatMap(item => Array.isArray(item[7]) ? item[7] : item[7] ? [item[7]] : []))];
    section.append(createGallery(name, work, images));
    const desc = document.createElement('p'); desc.className = 'description';
    const descriptions = [...new Set(items.map(item => item[6]).filter(Boolean))].join(' / ');
    desc.textContent = works.length > 1 ? `${work}: ${descriptions}` : descriptions;
    section.append(desc); detail.append(section);
  });
  detail.hidden = false;
  if (map && hasCoordinates(place)) map.setView([lat, lng], 14);
  renderList();
}

function renderList() {
  const visible = visiblePlaces();
  document.querySelector('#list-title').textContent = activeView === 'travel' ? '경로 주변 성지' : '장소';
  document.querySelector('#count').textContent = `${visible.length}곳`;
  document.querySelector('#list-legend').hidden = activeView !== 'travel' || !travelCandidates;
  if (activeView === 'explore' && nearby) nearbyStatus.textContent = `${nearby.name} 반경 ${nearby.radius}km에는 ${visible.length}개의 성지가 있어요.`;
  list.replaceChildren(...visible.map(group => {
    const place = representative(group);
    const button = document.createElement('button'); button.type = 'button'; button.className = `place${selected === group ? ' selected' : ''}`;
    button.title = place[0];
    const name = document.createElement('strong'); name.textContent = place[0];
    const works = [...new Set(group.map(item => item[3]))];
    const result = activeView === 'travel' && travelCandidates?.get(group);
    const info = document.createElement('small');
    info.textContent = result
      ? `경로에서 ${result.distance.toFixed(1)}km · ${works.join(' / ')}`
      : `${place[2]} / ${works.join(' / ')}`;
    info.title = info.textContent;
    button.append(name, info);
    button.addEventListener('click', () => showPlace(group, place));
    return button;
  }));
  if (!visible.length && activeView === 'travel') {
    const empty = document.createElement('p');
    empty.className = 'list-empty';
    empty.textContent = travelCandidates ? '경로 주변에서 성지를 찾지 못했습니다.' : '여행 경로를 검색하면 주변 성지가 표시됩니다.';
    list.append(empty);
  }
  requestAnimationFrame(updateListFade);
}

function updateListFade() {
  list.parentElement.classList.toggle('has-more', list.scrollTop + list.clientHeight < list.scrollHeight - 1);
}

list.addEventListener('scroll', updateListFade);
window.addEventListener('resize', updateListFade);
if (window.ResizeObserver) new ResizeObserver(updateListFade).observe(list);

function updateTravelFade() {
  travelView.classList.toggle('has-more', activeView === 'travel' &&
    travelScroll.scrollTop + travelScroll.clientHeight < travelScroll.scrollHeight - 1);
}

travelScroll.addEventListener('scroll', updateTravelFade);
window.addEventListener('resize', updateTravelFade);
if (window.ResizeObserver) {
  const observer = new window.ResizeObserver(updateTravelFade);
  observer.observe(travelScroll);
  observer.observe(travelForm);
}
if (window.MutationObserver) {
  new window.MutationObserver(updateTravelFade).observe(travelForm, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['hidden']
  });
}

function render() {
  selected = null; detail.hidden = true; renderList();
  if (!map) return;
  layer.clearLayers();
  const visible = visiblePlaces().map(group => ({ group, place: representative(group) }))
    .filter(({ place }) => hasCoordinates(place));
  visible.forEach(({ group, place }) => {
    const candidate = activeView === 'travel' && travelCandidates?.has(group);
    const marker = L.circleMarker([place[4], place[5]], {
      className: candidate ? 'travel-place-marker' : '',
      radius: candidate ? 10 : 7,
      color: '#ffffff',
      weight: candidate ? 3 : 2,
      fillColor: '#ff577b',
      fillOpacity: 1
    });
    marker.bindTooltip(place[0], {direction: 'top', offset: [0, -8]});
    marker.on('click', () => showPlace(group, place));
    marker.addTo(layer);
  });
  if (activeView === 'explore' && nearby) {
    const circle = L.circle([nearby.lat, nearby.lng], {
      radius: nearby.radius * 1000, color: '#ff577b', weight: 1, fillOpacity: .08,
      interactive: false
    }).addTo(layer);
    L.circleMarker([nearby.lat, nearby.lng], {
      radius: 5, color: '#ff577b', weight: 2, fillColor: '#ffffff', fillOpacity: 1,
      interactive: false
    }).addTo(layer);
    map.fitBounds(circle.getBounds(), {padding: [45, 45], maxZoom: 14});
  } else if (visible.length) {
    map.fitBounds(L.latLngBounds(visible.map(({ place }) => [place[4], place[5]])), {padding: [45, 45], maxZoom: 14});
  }
}

document.querySelectorAll('.tab').forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode;
  document.querySelectorAll('.tab').forEach(tab => { const active = tab === button; tab.classList.toggle('active', active); tab.setAttribute('aria-pressed', String(active)); });
  setupFilters();
}));

function switchView(view) {
  activeView = view;
  document.querySelector('.workspace').classList.toggle('travel-mode', view === 'travel');
  for (const name of ['explore', 'travel']) {
    const active = view === name;
    document.querySelector(`#view-${name}`).hidden = !active;
    const button = document.querySelector(`#view-${name}-tab`);
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  if (map && routeLayer) {
    if (view === 'travel') routeLayer.addTo(map);
    else map.removeLayer(routeLayer);
  }
  render();
  requestAnimationFrame(updateTravelFade);
  if (map) requestAnimationFrame(() => {
    if (view !== activeView) return;
    map.invalidateSize();
    if (view === 'travel' && plannedRoute) {
      map.fitBounds(L.latLngBounds(plannedRoute), {padding: [45, 45], maxZoom: 14});
    }
  });
}

document.querySelector('#view-explore-tab').addEventListener('click', () => switchView('explore'));
document.querySelector('#view-travel-tab').addEventListener('click', () => switchView('travel'));
for (const name of ['explore', 'travel']) {
  document.querySelector(`#view-${name}-tab`).addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'explore' : event.key === 'End' ? 'travel' :
      (activeView === 'explore' ? 'travel' : 'explore');
    switchView(next);
    document.querySelector(`#view-${next}-tab`).focus();
  });
}
filter.addEventListener('change', () => {
  setupEpisodes();
  render();
});
episodeFilter.addEventListener('change', render);
if (window.L) {
  map = L.map('map', {zoomControl: false, minZoom: 5, maxZoom: 18});
  L.control.zoom({position: 'bottomleft'}).addTo(map);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {minZoom: 5, maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap 기여자</a>'}).addTo(map);
  layer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup();
} else {
  document.querySelector('#map').textContent = '지도를 불러오지 못했습니다. 인터넷 연결을 확인하세요.';
}
setupFilters();
