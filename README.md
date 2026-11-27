# 백합조아 (티스토리) Mangayomi 익스텐션

[백.합.조.아](https://123zxcv52.tistory.com/) 티스토리 블로그의 만화를 [Mangayomi](https://github.com/kodjodevf/mangayomi)에서 볼 수 있는 JavaScript 익스텐션(`sourceCodeLanguage: 1`)입니다.

## 지원 범위
- **포함 분류**: `번역중`, `완결`, `웹코믹`, `동인지`, `번역중단`
- **제외 분류**: `정발비공개` (`정발미공개`), `암호관련`, `개인용`, `번역예정`
- **기능**:
  - 인기/전체 작품 목록(`getPopular`) 및 최신 업데이트(`getLatestUpdates`)
  - 분류 필터(`전체`, `번역중`, `완결`, `웹코믹`, `동인지`, `번역중단`) 및 키워드 검색(`search`)
  - 작품별 회차 목록(`getDetail`) 및 본문 이미지 뷰어(`getPageList`, `Referer` 헤더 포함)

## 설치 방법

### 1. 원격 저장소(GitHub / GitHub Pages)로 추가
1. 이 폴더를 GitHub 저장소에 업로드합니다.
2. [index.json](index.json)의 `"sourceCodeUrl"`을 실제 호스팅된 Raw URL로 수정합니다.
   - 예: `"https://raw.githubusercontent.com/<사용자>/<저장소>/main/manga/baekhapjoa.js"`
3. Mangayomi 앱 → **Extensions(확장)** → **저장소 추가**에 호스팅된 `index.json` URL을 등록합니다.

### 2. 로컬 스크립트로 직접 테스트
Mangayomi의 익스텐션 개발/테스트 기능에서 `manga/baekhapjoa.js` 파일을 직접 불러와 사용할 수 있습니다.
