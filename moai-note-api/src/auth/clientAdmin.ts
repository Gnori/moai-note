/**
 * 클라이언트 등록·조회·폐기 CLI.
 *
 * HTTP로 노출하지 않는다 — 등록 API 자체가 공격면이 된다.
 * 시크릿은 생성 시점에 한 번만 출력되며 이후 복구할 수 없다(해시만 저장).
 *
 *   npm run client:add -- --name "SeedAI 챗봇"
 *   npm run client:list
 *   npm run client:revoke -- --id cli_xxx
 */
import { loadConfig } from '../config.ts';
import { openDatabase } from '../storage/db.ts';
import { ClientStore } from '../storage/clientStore.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const command = process.argv[2];
  const cfg = loadConfig();
  const db = openDatabase(cfg.dbPath);
  const clients = new ClientStore(db);

  switch (command) {
    case 'add': {
      const name = arg('name');
      if (!name) {
        console.error('사용법: npm run client:add -- --name "<호스트 이름>"');
        process.exit(1);
      }
      const created = clients.create(name);
      console.log('클라이언트를 등록했습니다.\n');
      console.log(`  client_id     : ${created.clientId}`);
      console.log(`  client_secret : ${created.clientSecret}`);
      console.log('\n⚠️  시크릿은 지금만 볼 수 있습니다. 안전한 곳에 보관하십시오.');
      console.log('   서버에는 해시만 저장되어 복구할 수 없습니다.');
      console.log('   브라우저로 내려보내지 마십시오 — 서버 간 호출 전용입니다.');
      break;
    }

    case 'list': {
      const rows = clients.list();
      if (rows.length === 0) {
        console.log('등록된 클라이언트가 없습니다.');
        break;
      }
      console.log('client_id                      상태     이름');
      for (const r of rows) {
        const state = r.revoked ? '폐기됨' : '활성 ';
        console.log(`${r.clientId.padEnd(30)} ${state}   ${r.name}`);
      }
      break;
    }

    case 'revoke': {
      const id = arg('id');
      if (!id) {
        console.error('사용법: npm run client:revoke -- --id <client_id>');
        process.exit(1);
      }
      if (clients.revoke(id)) {
        console.log(`폐기했습니다: ${id}`);
        console.log('발급된 토큰도 즉시 거부됩니다(만료 전이라도).');
      } else {
        console.error(`해당 client_id 를 찾을 수 없습니다: ${id}`);
        process.exit(1);
      }
      break;
    }

    default:
      console.error('명령: add | list | revoke');
      process.exit(1);
  }

  db.close();
}

main();
