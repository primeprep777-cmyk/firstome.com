# firstome.com

퍼스트옴(Firstome) 홈페이지. GitHub Pages로 `main` 브랜치 루트를 그대로 배포합니다. 빌드 과정은 없습니다.

| 주소 | 파일 | 내용 |
| --- | --- | --- |
| https://firstome.com/ | `index.html` | 퍼스트옴 모회사 소개 (스크롤 연동 시료 흐름, 회사 구조, 세 사업 브랜드, 운영 원칙, 파트너, 팀·연구소, 문의) |
| https://firstome.com/samplo/ | `samplo/index.html` | 샘플로 브랜드 사이트 (전처리 · 실시간 추적 · QC 선택권 · 수행 체계·키트 · 바이오뱅킹 · 요금제 · 패밀리 · 의뢰 상담) |
| https://firstome.com/omicsmate/ | `omicsmate/index.html` | 오믹스메이트 브랜드 사이트 (AI 1차 분석 · 전문가 매칭 · 패밀리 · 분석 의뢰 · 전문가 참여) |
| https://firstome.com/dx/ | `dx/index.html` | 퍼스트옴 Dx 브랜드 사이트 (단계별 서비스 · 가진 것 · 협업 흐름 · 기준과 투명성 · 협업 상담) |

- `site/`: 공통 CSS·JS (`site.css`, `site.js` 스크롤 등장 효과, `hero-flow.*` 메인 상단 시료 흐름, `samplo.js` 추적 화면)
- `assets/`: 섹션 사진 10장
- `CNAME`: 사용자 도메인 `firstome.com` / `.nojekyll`: Jekyll 처리 없이 그대로 배포 / `404.html`, `favicon.svg`
- 각 `index.html` 상단의 `"theme"` 값(`console` 다크, `lab` 라이트, `mixed`)과 `"imageTone"` 값으로 톤을 바꿀 수 있습니다.

운영 규칙
- 문의는 카카오톡 채널(https://pf.kakao.com/_uuXFX)로 받습니다. 이메일과 온라인 접수 폼은 아직 없습니다(준비 중 표기).
- 가격은 공개하지 않습니다. 품질 체계는 "GCLP에 준하는"으로 표기합니다 (인증 아님).
- 파트너 로고와 팀원 소개는 계약·법인 설립 후 채웁니다. 메인의 파트너 섹션은 유형만, 팀 섹션은 연구소 사진과 소개 문구만 보여 줍니다.

사이트 구조 (2026-10-09 개편)
- 메인(`/`)은 모회사 퍼스트옴 소개만 맡습니다. 서비스 설명과 문의는 각 브랜드 사이트(`/samplo/`, `/omicsmate/`, `/dx/`)가 따로 가집니다.
- 브랜드 사이트는 자기 이름의 로고·메뉴·푸터를 쓰고, 상단의 얇은 "Firstome family" 띠와 푸터 한 줄로만 모회사·다른 브랜드에 연결됩니다.
- 공통 띠와 브랜드 로고 스타일은 `site/site.css`의 `.fam`, `.logo.brand`에 있습니다. 브랜드를 추가하면 네 페이지의 띠에 링크를 한 줄씩 넣어 주세요.
- 모든 페이지 끝에 AI 상담 위젯 한 줄(`site/firstome-chat.js`)이 있습니다. 새 페이지를 만들면 같은 줄을 넣어 주세요.
