import { withBasePath } from '@/lib/paths'

export default function HomePage() {
  return (
    <main>
      <h1>Chat</h1>
      <form action={withBasePath('/api/chat')} method="post">
        <input name="message" aria-label="Message" />
        <button type="submit">Send</button>
      </form>
    </main>
  )
}
