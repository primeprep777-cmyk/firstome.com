/* 오믹스메이트 · 샘플로 앱 설정 (두 서비스가 같은 Supabase 프로젝트와 계정을 씁니다).
   Supabase 대시보드 > Project Settings > API 에서 Project URL 과 publishable key(또는 예전 anon public key)를 넣습니다.
   이 키는 공개되어도 되는 키입니다 (권한은 supabase/*.sql 의 규칙이 지킵니다).
   secret / service_role key 는 절대 여기에 넣지 마세요.
   두 값이 비어 있으면 사이트는 지금처럼 카카오톡 상담으로 안내합니다. */
window.OM_CONFIG = {
  url: "https://ilohifauyxeqnjbftdhr.supabase.co",
  anonKey: "sb_publishable_DeKK9Vk4aQlcVjaNl6bENg_B99o-YDs",

  /* 카카오 로그인 버튼 ("카카오로 3초 만에 시작", 샘플로 로그인 화면). 아래 준비를 마친 뒤에만 true 로 바꾸세요.
     준비가 덜 된 채 켜면 버튼을 누른 고객이 오류 화면을 보게 됩니다.
     1) 카카오 디벨로퍼스(developers.kakao.com) > 내 애플리케이션 > 앱 추가
        - 카카오 로그인 활성화, Redirect URI 에 https://ilohifauyxeqnjbftdhr.supabase.co/auth/v1/callback 등록
        - 동의항목: 닉네임, 카카오계정(이메일). 이메일을 받으려면 비즈 앱 전환이 필요할 수 있습니다.
        - 보안 > Client Secret 발급 · 사용함
     2) Supabase 대시보드 > Authentication > Sign In / Providers > Kakao 를 켜고 REST API 키와 Client Secret 입력
     3) Supabase 대시보드 > Authentication > URL Configuration > Redirect URLs 에 https://firstome.com/samplo/** 가 있는지 확인
     4) 아래 값을 true 로 바꾸고 배포 */
  kakao: false,

  /* 샘플로 온라인 의뢰 열기. supabase/samplo.sql 실행 → 운영 화면 > 설정에서 실제 접수 기준 · 입금 안내 입력 → 메일 발송(SMTP) · 메일 문구 설정 → 개인정보 처리방침 · 약관 검토를 마친 뒤 true 로 바꾸고 배포합니다.
     false 면 샘플로 소개 페이지는 카카오톡 상담 안내 그대로이고, 앱 화면은 운영자만 쓸 수 있습니다 (오픈 전 점검용). */
  samplo: false
};
