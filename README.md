# Mangayomi 한국어 백합 익스텐션 저장소

[Mangayomi](https://github.com/kodjodevf/mangayomi)에서 사용할 수 있는 JavaScript 익스텐션(`sourceCodeLanguage: 1`) 저장소입니다.

## 포함된 소스
1. **백합조아 (티스토리)** (`itemType: 0`, 만화)
   - 대상: `https://123zxcv52.tistory.com/`
   - 지원 분류: `번역중`, `완결`, `웹코믹`, `동인지`, `번역중단` (`정발비공개`, `암호관련`, `개인용`, `번역예정` 제외)
2. **LilyReader 만화** (`itemType: 0`, 만화 탐색 소스)
   - 대상: `https://www.lilyreader.online/`
   - 필터: `전체`, `웹툰`, `연재중`, `완결`, `모음집` / 정렬: `최근 업데이트순`, `가나다순`, `회차 많은순`
3. **LilyReader 소설** (`itemType: 2`, 소설 탐색 소스)
   - 대상: `https://www.lilyreader.online/`
   - 필터: `전체`, `웹툰`, `연재중`, `완결`, `모음집` / 정렬: `최근 업데이트순`, `가나다순`, `회차 많은순`

## Mangayomi 등록 방법
Mangayomi 앱 → **Extensions(확장)** → **저장소 추가**에 아래 `index.json` 주소를 추가하면 **만화 탐색 소스**와 **소설 탐색 소스**에서 각각 사용할 수 있습니다.

```text
https://raw.githubusercontent.com/89maro27-cmyk/mangayomi-baekhapjoa/main/index.json
```
