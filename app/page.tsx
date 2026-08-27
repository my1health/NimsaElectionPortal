 "use client";

import { useEffect, useState } from "react";

type Category = { id: string; name: string; description: string | null };
type Nominee = { id: string; name: string; bio: string | null; category_id: string; };
type Result = Nominee & { votes: number };

export default function Home() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [nominees, setNominees] = useState<Nominee[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [selected, setSelected] = useState<Nominee | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/categories");
    const data = await r.json();
    setCategories(data.categories || []);
    setNominees(data.nominees || []);
    setResults(data.results || []);
  }

  useEffect(() => { load(); }, []);

  async function vote() {
    if (!selected || !email.trim()) {
      setMessage("Please enter your email.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/vote", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ nomineeId: selected.id, email: email.trim().toLowerCase() })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Vote failed.");
      setMessage("Vote submitted successfully.");
      setSelected(null); setEmail("");
      await load();
    } catch (e: any) {
      setMessage(e.message);
    } finally { setBusy(false); }
  }

  return (
    <>
      <header className="hero">
        <div className="container">
          <span className="badge">NiMSA • CATEGORY B</span>
          <h1>Personality Awards</h1>
          <p>Vote for the personalities who have made an outstanding impact.</p>
        </div>
      </header>

      <main className="container section">
        <h2>Categories</h2>
        <p>Select a category and vote for your preferred nominee.</p>

        <div className="grid">
          {categories.map(category => (
            <section className="card" key={category.id}>
              <h3>{category.name}</h3>
              <p>{category.description || "Choose your preferred nominee."}</p>
              <div>
                {nominees.filter(n => n.category_id === category.id).map(n => (
                  <div key={n.id} style={{marginBottom:12}}>
                    <strong>{n.name}</strong>
                    {n.bio && <p style={{margin:"4px 0 8px"}}>{n.bio}</p>}
                    <button className="voteBtn" onClick={() => setSelected(n)}>VOTE</button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="section">
          <h2>Current Leaderboard</h2>
          <div className="card">
            {categories.map(category => {
              const list = results.filter(x => x.category_id === category.id)
                .sort((a,b) => b.votes - a.votes);
              return (
                <div key={category.id} style={{marginBottom:25}}>
                  <h3>{category.name}</h3>
                  {list.map((x,i) => (
                    <div className="rank" key={x.id}>
                      <span>#{i+1} {x.name}</span><strong>{x.votes} votes</strong>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {selected && (
        <div className="modalWrap">
          <div className="modal">
            <h2>Vote for {selected.name}</h2>
            <p>Enter your email. For this MVP, one vote per category is allowed per email.</p>
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            {message && <div className={"notice " + (message.includes("success") ? "success" : "error")}>{message}</div>}
            <button className="voteBtn" disabled={busy} onClick={vote}>
              {busy ? "Submitting..." : "SUBMIT VOTE"}
            </button>
            <button className="voteBtn close" onClick={() => {setSelected(null);setMessage("");}}>
              CANCEL
            </button>
          </div>
        </div>
      )}

      <footer className="footer">NiMSA Category B Awards • Voting Portal</footer>
    </>
  );
}