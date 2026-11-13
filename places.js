// 작품별 장소 목록을 모아 지도에 전달합니다.
// 같은 장소는 좌표를 맞추고, 이름이 다르면 각 항목에 같은 placeId를 적습니다.
const placesByWork = {
  "걸즈 밴드 크라이": girlsbandcryPlaces,
  "길모퉁이 마족": machikadoPlaces,
  "별무리 텔레패스": hoshitelePlaces,
  "슈퍼커브": supercubPlaces,
  "어설트 릴리 BOUQUET": assaultlilyPlaces,
  "유루캠△": yurucampPlaces,
  "초 카구야 공주!": kaguyaPlaces,
  "카미이나 보탄": botanPlaces,
  "하얀 모래의 아쿠아톱": aquatopePlaces,
  "BanG Dream! It’s MyGO!!!!!": mygoPlaces,
  "BanG Dream! Ave Mujica": avemujicaPlaces,
};

const places = Object.entries(placesByWork).flatMap(([work, locations]) =>
  locations.map(({ name, japanese, region, lat, lng, description, image, episode, placeId }) =>
    [name, japanese, region, work, lat, lng, description, image, episode, placeId]
  )
);
