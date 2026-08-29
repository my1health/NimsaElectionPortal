"use client";

import { useEffect, useState } from "react";

type Category = {
  id: string;
  name: string;
  description: string | null;
};

type Nominee = {
  id: string;
  name: string;
  bio: string | null;
  category_id: string;
  photo_url: string | null;
};

type Result = Nominee & {
  votes: number;
};

export default function Home() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [nominees, setNominees] = useState<Nominee[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [selected, setSelected] = useState<Nominee | null>(null);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const r = await fetch("/api/categories", {
        cache: "no-store",
      });

      const data = await r.json();

      setCategories(data.categories || []);
      setNominees(data.nominees || []);
      setResults(data.results || []);
    } catch {
      setMessage("Unable to load the election data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function vote() {
    if (!selected || !email.trim()) {
      setMessage("Please enter your email address.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const r = await fetch("/api/vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          nomineeId: selected.id,
          email: email.trim().toLowerCase(),
        }),
      });

      const data = await r.json();

      if (!r.ok) {
        throw new Error(data.error || "Vote failed.");
      }

      setMessage("Vote submitted successfully.");
      setSelected(null);
      setEmail("");

      await load();
    } catch (e: any) {
      setMessage(e.message || "Vote failed.");
    } finally {
      setBusy(false);
    }
  }

  function nomineesForCategory(categoryId: string) {
    return nominees.filter(
      (nominee) => nominee.category_id === categoryId
    );
  }

  return (
    <div className="site">

      {/* NAVBAR */}
      <header className="navbar">
        <div className="nav-inner">

          <div className="brand">
            <div className="brand-mark">N</div>

            <div>
              <div className="brand-title">NiMSA</div>
              <div className="brand-subtitle">
                CATEGORY B AWARDS
              </div>
            </div>
          </div>

          <nav className="nav-links">
            <a href="#categories">Categories</a>
            <a href="#leaderboard">Leaderboard</a>
            <a href="/admin">Admin</a>
          </nav>

        </div>
      </header>


      {/* HERO */}
      <section className="hero-awards">

        <div className="hero-overlay"></div>

        <div className="hero-content">

          <div className="hero-badge">
            NIGERIA MEDICAL STUDENTS&apos; ASSOCIATION
          </div>

          <p className="hero-small">
            CATEGORY B
          </p>

          <h1>
            Personality
            <br />
            <span>Awards</span>
          </h1>

          <p className="hero-description">
            Celebrating exceptional personalities,
            leadership, creativity and impact within
            the NiMSA community.
          </p>

          <a
            href="#categories"
            className="hero-button"
          >
            VOTE NOW
            <span>→</span>
          </a>

        </div>

        <div className="hero-decoration">
          <div></div>
          <div></div>
          <div></div>
        </div>

      </section>


      {/* INTRO */}
      <section className="intro-section">

        <div className="section-container">

          <div className="gold-line"></div>

          <p className="eyebrow">
            THE 2026 CATEGORY B AWARDS
          </p>

          <h2>
            Honour the personalities
            <br />
            who make a difference.
          </h2>

          <p className="intro-text">
            Every vote is an opportunity to recognize
            outstanding NiMSAites whose leadership,
            service, creativity and achievements
            have made a lasting impact.
          </p>

        </div>

      </section>


      {/* CATEGORIES */}
      <main
        id="categories"
        className="categories-section"
      >

        <div className="section-container">

          <div className="section-heading">
            <div>
              <p className="eyebrow">AWARD CATEGORIES</p>

              <h2>
                Choose your category
              </h2>
            </div>

            <p>
              Select your preferred nominee
              and cast your vote.
            </p>
          </div>


          {loading ? (

            <div className="loading-box">
              Loading nominees...
            </div>

          ) : (

            <div className="category-list">

              {categories.map((category, categoryIndex) => {

                const categoryNominees =
                  nomineesForCategory(category.id);

                return (

                  <section
                    className="category-block"
                    key={category.id}
                  >

                    <div className="category-header">

                      <div className="category-number">
                        {String(categoryIndex + 1).padStart(2, "0")}
                      </div>

                      <div>
                        <p className="category-label">
                          CATEGORY {categoryIndex + 1}
                        </p>

                        <h3>
                          {category.name}
                        </h3>

                        <p>
                          {category.description ||
                            "Choose your preferred nominee."}
                        </p>
                      </div>

                    </div>


                    {categoryNominees.length === 0 ? (

                      <div className="empty-nominees">
                        Nominees for this category
                        will appear here.
                      </div>

                    ) : (

                      <div className="nominee-grid">

                        {categoryNominees.map((nominee) => (

                          <article
                            className="nominee-card"
                            key={nominee.id}
                          >

                            <div className="nominee-image">

                              {nominee.photo_url ? (

                                <img
                                  src={nominee.photo_url}
                                  alt={nominee.name}
                                />

                              ) : (

                                <div className="no-photo">
                                  N
                                </div>

                              )}

                              <div className="nominee-number">
                                NOMINEE
                              </div>

                            </div>


                            <div className="nominee-content">

                              <h4>
                                {nominee.name}
                              </h4>

                              {nominee.bio && (
                                <p>
                                  {nominee.bio}
                                </p>
                              )}

                              <button
                                className="nominee-vote"
                                onClick={() =>
                                  setSelected(nominee)
                                }
                              >
                                <span>
                                  CAST YOUR VOTE
                                </span>

                                <strong>→</strong>
                              </button>

                            </div>

                          </article>

                        ))}

                      </div>

                    )}

                  </section>

                );

              })}

            </div>

          )}

        </div>

      </main>


      {/* LEADERBOARD */}
      <section
        id="leaderboard"
        className="leaderboard-section"
      >

        <div className="section-container">

          <div className="leaderboard-heading">

            <p className="eyebrow">
              LIVE RESULTS
            </p>

            <h2>
              Current Leaderboard
            </h2>

            <p>
              Follow the race as votes are counted.
            </p>

          </div>


          <div className="leaderboard">

            {categories.map((category) => {

              const list = results
                .filter(
                  (x) =>
                    x.category_id === category.id
                )
                .sort(
                  (a, b) =>
                    b.votes - a.votes
                );

              return (

                <div
                  className="leader-category"
                  key={category.id}
                >

                  <h3>
                    {category.name}
                  </h3>

                  {list.length === 0 ? (

                    <p className="leader-empty">
                      No votes yet.
                    </p>

                  ) : (

                    list.map((nominee, index) => (

                      <div
                        className={
                          "leader-row " +
                          (index === 0
                            ? "leader-first"
                            : "")
                        }
                        key={nominee.id}
                      >

                        <div className="rank">
                          {index + 1}
                        </div>

                        {nominee.photo_url ? (

                          <img
                            src={nominee.photo_url}
                            alt={nominee.name}
                          />

                        ) : (

                          <div className="leader-avatar">
                            N
                          </div>

                        )}

                        <div className="leader-name">
                          <strong>
                            {nominee.name}
                          </strong>

                          {index === 0 && (
                            <span>
                              CURRENT LEADER
                            </span>
                          )}
                        </div>

                        <div className="vote-count">
                          <strong>
                            {nominee.votes}
                          </strong>

                          <span>
                            votes
                          </span>
                        </div>

                      </div>

                    ))

                  )}

                </div>

              );

            })}

          </div>

        </div>

      </section>


      {/* FOOTER */}
      <footer className="footer">

        <div className="section-container">

          <div className="footer-brand">
            <div className="brand-mark">
              N
            </div>

            <div>
              <strong>
                NiMSA
              </strong>

              <span>
                Category B Personality Awards
              </span>
            </div>
          </div>

          <p>
            Celebrating excellence, leadership
            and impact.
          </p>

          <div className="footer-bottom">
            © 2026 NiMSA Category B Awards
          </div>

        </div>

      </footer>


      {/* VOTING MODAL */}
      {selected && (

        <div
          className="modal-backdrop"
          onClick={() => {
            if (!busy) {
              setSelected(null);
              setMessage("");
            }
          }}
        >

          <div
            className="vote-modal"
            onClick={(e) =>
              e.stopPropagation()
            }
          >

            <button
              className="modal-close"
              onClick={() => {
                setSelected(null);
                setMessage("");
              }}
              disabled={busy}
            >
              ×
            </button>


            <div className="modal-label">
              CAST YOUR VOTE
            </div>

            <h2>
              Vote for
              <br />
              <span>{selected.name}</span>
            </h2>

            <p className="modal-category">
              {
                categories.find(
                  (category) =>
                    category.id ===
                    selected.category_id
                )?.name
              }
            </p>


            {selected.photo_url && (

              <img
                className="modal-photo"
                src={selected.photo_url}
                alt={selected.name}
              />

            )}


            <p className="modal-instruction">
              Enter your email address to submit
              your vote.
            </p>

            <input
              className="email-input"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) =>
                setEmail(e.target.value)
              }
              disabled={busy}
            />


            {message && (

              <div
                className={
                  "modal-message " +
                  (message.includes("success")
                    ? "success"
                    : "error")
                }
              >
                {message}
              </div>

            )}


            <button
              className="submit-vote"
              disabled={busy}
              onClick={vote}
            >
              {busy
                ? "SUBMITTING..."
                : "SUBMIT VOTE →"}
            </button>


            <p className="modal-note">
              One vote per category is allowed
              per email.
            </p>

          </div>

        </div>

      )}

    </div>
  );
}
