import { useEffect, useState } from 'react'

function App() {
  const [msg, setMsg] = useState('読み込み中...')

  useEffect(() => {
    fetch('/api/data')
      .then(res => res.json())
      .then(data => setMsg(data.message))
  }, [])

  return <h1>{msg}</h1>
}

export default App