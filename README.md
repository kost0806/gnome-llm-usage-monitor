# AI Usage — GNOME Shell extension

Ubuntu 상단바에 Claude Enterprise 사용 금액과 Codex 크레딧 사용률을 채움 캡슐로 상시 표시합니다. 5분마다 갱신하며, 클릭하면 금액·크레딧 상세와 새로고침 메뉴가 열립니다.

```
[✳ (██10%      )  ◎ (█2%        )]
```

- 캡슐 채움 = 사용률. 75% 이상 노랑, 95% 이상 빨강. 오류 시 마지막 값을 반투명으로 유지.

- 대상: GNOME Shell 50 (Ubuntu 26.04, Wayland). 다른 버전이면 `ai-usage@local/metadata.json`의 `shell-version`을 `gnome-shell --version` 메이저 값으로 바꾸세요.
- Claude: Claude Code 로그인 토큰(`~/.claude/.credentials.json`)으로 `api.anthropic.com/api/oauth/usage` 조회. Admin 키 불필요.
- Codex: 확장이 `codex app-server`를 자식 프로세스로 띄워 `account/rateLimits/read` 조회.

## 설치

릴리즈 zip:

```sh
gnome-extensions install --force ai-usage@local-<버전>.shell-extension.zip
# 로그아웃 → 로그인 후
gnome-extensions enable ai-usage@local
```

소스에서 (심볼릭 링크, 코드 수정 후 재로그인만 하면 반영):

```sh
./install.sh
```

개발 중 테스트: `dbus-run-session gnome-shell --devkit --wayland` · 로그: `journalctl -f -o cat /usr/bin/gnome-shell`

## 상태 표시

| 상태 | 표시 |
| --- | --- |
| 0–74% | 기본 색 |
| 75–94% | 노랑 `#f5c26b` |
| 95% 이상 | 빨강 `#ff8a7a` |
| 첫 로딩 | `…` |
| 오류 | 마지막 값을 50% 투명도로 유지 (값이 없으면 `—`), 메뉴에 원인 표시 |

## 응답 필드 매핑

| 공급자 | 필드 |
| --- | --- |
| Claude | `spend.used` / `spend.limit` (`amount_minor`, `exponent`) → 없으면 `extra_usage.used_credits` / `monthly_limit` |
| Codex | `rateLimits.individualLimit.{used, limit, resetsAt}` → 없으면 `rateLimitsByLimitId.codex.individualLimit` |

> 2026-10-01 기준 실제 응답으로 확인한 것은 Max(Claude) / Plus(Codex) 계정뿐입니다. 두 계정 모두 한도 필드가 `null`이었고, Enterprise에서 값이 채워진 형태는 스키마로만 확인했습니다. Enterprise 계정에서 메뉴에 "정보 없음"이 뜨면 `lib/claude.js`, `lib/codex.js` 상단 주석의 방법으로 응답을 확인해 `lib/parse.js`를 조정하세요.

## 개발

```sh
npm test        # 순수 모듈 단위 테스트 (format / parse / codexPath)
npm run check   # GJS 모듈 문법 검사
./scripts/pack.sh 1.0.0   # dist/ai-usage@local-1.0.0.shell-extension.zip
```

릴리즈: `git tag v1.0.0 && git push origin v1.0.0` → GitHub Actions가 테스트 후 zip을 릴리즈에 첨부합니다.

디자인 시안: claude.ai/design 프로젝트 "Claude와 Codex 사용량 모니터" (`AI Usage Extension.dc.html`, `IMPLEMENTATION.md`).
