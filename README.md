# ssh-open

SSH 接続先のリモートサーバーで `ssh-open .` と打つと、ローカルのブラウザにファイル/画像がリアルタイムで表示されるツールです。

```
[Remote]  ssh-open /path/to/images
             ↓ (HTTP POST)
          ssh-open-server :18766
             ↑ (SSH フォワードトンネル)
[Local]   ブラウザ → http://localhost:18766
```

---

## 仕組み

- `ssh-open-server`（Goバイナリ）を**リモート**で起動しておく
- SSH接続時に `-L` オプションでポートフォワードを張る
- **ローカル**のブラウザで `http://localhost:18766` を開いておく
- リモートで `ssh-open <パス>` を打つと、SSE 経由でブラウザが即座に切り替わる

リバーストンネル不要。ローカル側でサーバーを動かす必要もありません。

---

## インストール

### 前提

- **ローカル**: SSH クライアント、ブラウザ
- **リモート**: Go 1.21+ (ビルド時のみ)、`curl`

### ビルドとデプロイ

ローカルのこのリポジトリで作業します。

まず接続先を `.remote` ファイルに書いておきます:

```bash
cp .remote.example .remote
# .remote を編集して REMOTE_HOST=user@your-server に変える
```

あとは:

```bash
# 依存関係のインストール
cd frontend && npm install && cd ..

# ビルドしてリモートに転送
make install
```

`make install` は以下の2ファイルをリモートの `~/.local/bin/` に転送します:
- `ssh-open-server` — ファイルサーバー本体
- `ssh-open` — コマンドラインツール

リモートの `~/.local/bin/` が `$PATH` に入っていない場合は、リモートの `~/.bashrc` か `~/.zshrc` に追加してください:

```bash
export PATH="$HOME/bin:$PATH"
```

---

## セットアップ

### リモート側

`ssh-open-server` を起動します。

```bash
# 手動で起動 (フォアグラウンド)
ssh-open-server

# バックグラウンドで起動
ssh-open-server &

# ポートを変えたい場合
ssh-open-server --port 19000
```

デフォルトポートは `18766` です。ログインのたびに手動起動が面倒な場合は、後述の systemd 設定を参照してください。

### ローカル側

SSH 接続時に `-L` オプションでポートをフォワードします。

```bash
ssh -L 18766:localhost:18766 user@your-server
```

これにより、ローカルの `localhost:18766` へのアクセスがリモートの `ssh-open-server` に届くようになります。

毎回 `-L` を付けるのが面倒な場合は、`~/.ssh/config` に書いておくと自動で張られます:

```
Host your-server
    HostName your-server.example.com
    User user
    LocalForward 18766 localhost:18766
```

---

## 使い方

### 基本的な流れ

1. **リモートで** `ssh-open-server` が起動していることを確認
2. **ローカルで** `ssh -L 18766:localhost:18766 user@your-server` で接続
3. **ローカルのブラウザで** `http://localhost:18766` を開く
4. **リモートで** `ssh-open <パス>` を打つ

```bash
# カレントディレクトリを開く
ssh-open .

# 特定のディレクトリを開く
ssh-open ~/pictures/2024

# 絶対パスも使える
ssh-open /var/log
```

ブラウザ側はパスが変わるたびに自動で更新されます。ページをリロードする必要はありません。

### ブラウザ上での操作

**リストビュー (デフォルト)**
- ディレクトリをクリック → そのディレクトリに移動
- 画像ファイルをクリック → 右ペインにプレビューを表示
- パンくずリスト → 任意の階層に移動
- `..` → 親ディレクトリに移動

**ギャラリービュー**
- 右上のボタンで切り替え
- 画像サムネイルが一覧表示される
- サムネイルをクリック → プレビューを表示

**プレビュー**
- `←` `→` キー (または画面端のボタン) → 前後の画像に移動
- `Esc` キー (または `✕` ボタン) → プレビューを閉じる

---

## systemd による自動起動 (リモート)

ログインのたびに手動起動するのが面倒な場合、systemd のユーザーサービスとして登録できます。

**リモートで** 以下のファイルを作成します:

```bash
mkdir -p ~/.config/systemd/user
```

`~/.config/systemd/user/ssh-open-server.service`:

```ini
[Unit]
Description=ssh-open file server

[Service]
ExecStart=%h/bin/ssh-open-server --port 18766
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
# 有効化して起動
systemctl --user enable --now ssh-open-server

# 状態確認
systemctl --user status ssh-open-server
```

---

## 開発

```bash
# Go サーバー (:18766) と Vite dev server (:5173) を同時起動
make dev
```

開発中は `http://localhost:5173` をブラウザで開きます。
Vite が `/api` へのリクエストを Go サーバーにプロキシします。

```bash
# フロントエンドのビルドのみ
cd frontend && npm run build

# バイナリのビルドのみ (frontend/dist が必要)
go build -o ssh-open-server .
```

### API エンドポイント

| メソッド | パス | 説明 |
|--------|------|------|
| `POST` | `/api/set-path` | 表示パスを変更 (`path` フォームパラメータ) |
| `GET`  | `/api/current-path` | 現在のパスを取得 |
| `GET`  | `/api/files?path=<path>` | ファイル一覧を取得 |
| `GET`  | `/api/file?path=<path>` | ファイルを配信 |
| `GET`  | `/api/events` | SSE — パス変更のプッシュ通知 |

---

## オプション

### `ssh-open-server`

```
--port int   待ち受けポート (デフォルト: 18766)
--dev        開発モード (組み込みフロントエンドを使わない)
```

### `ssh-open`

環境変数 `SSH_OPEN_PORT` でポートを変更できます:

```bash
SSH_OPEN_PORT=19000 ssh-open .
```
