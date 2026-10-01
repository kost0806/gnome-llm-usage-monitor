## 설치

GNOME Shell 50 (Ubuntu 26.04, Wayland) 기준.

```sh
gh release download {{TAG}} -R {{REPO}} -p 'ai-usage@local.shell-extension.zip'
gnome-extensions install --force ai-usage@local.shell-extension.zip
```

Wayland에서는 Shell을 재시작할 수 없으므로 **로그아웃 → 로그인** 후 활성화합니다.

```sh
gnome-extensions enable ai-usage@local
```

사전 조건: Claude Code(`claude`)와 Codex CLI(`codex`)가 설치되어 있고 각각 로그인되어 있어야 합니다.

## 업데이트

```sh
gh release download {{TAG}} -R {{REPO}} -p 'ai-usage@local.shell-extension.zip' --clobber
gnome-extensions install --force ai-usage@local.shell-extension.zip
```

설치 후 **로그아웃 → 로그인**하면 새 버전이 적용됩니다 (활성화 상태는 유지됨). 적용된 버전 확인: `gnome-extensions info ai-usage@local`

> `./install.sh`(소스 심볼릭 링크)로 설치했다면 zip 대신 `git pull` 후 재로그인하세요. zip으로 바꾸려면 먼저 링크를 지웁니다: `rm ~/.local/share/gnome-shell/extensions/ai-usage@local`

## 문제 확인

```sh
journalctl -f -o cat /usr/bin/gnome-shell | grep ai-usage
```
