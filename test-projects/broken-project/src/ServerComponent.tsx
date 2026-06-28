export function ServerComponent() {
  const user = { password: 'secretpassword123', api_key: 'sk_live_123' };

  // Potential Data Leak: passing sensitive props to JSX elements in a Server Component
  return (
    <div>
      <ChildComponent password={user.password} />
      <AnotherComponent api_key={user.api_key} />
    </div>
  );
}
