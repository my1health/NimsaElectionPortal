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

  const [quantity, setQuantity] = useState(1);

  const [message, setMessage] = useState("");

  const [busy, setBusy] = useState(false);

  const VOTE_PRICE = 100;

  const totalAmount = quantity * VOTE_PRICE;

  async function load() {
    try {
      const r = await fetch("/api/categories");

      const data = await r.json();

      setCategories(data.categories || []);
      setNominees(data.nominees || []);
      setResults(data.results || []);
    } catch {
      setMessage("Unable to load voting data.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  function openVote(nominee: Nominee) {
    setSelected(nominee);
    setEmail("");
    setQuantity(1);
    setMessage("");
  }

  function closeVote() {
    if (busy) return;

    setSelected(null);
    setEmail("");
    setQuantity(1);
    setMessage("");
  }

  async function startPayment() {
    if (!selected) {
      return;
    }

    if (!email.trim()) {
      setMessage("Please enter your email.");
      return;
    }

    if (!email.includes("@")) {
      setMessage("Please enter a valid email.");
      return;
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      setMessage("Please select a valid number of votes.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const r = await fetch("/api/payment/initialize", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          nomineeId: selected.id,
          email: email.trim().toLowerCase(),
          quantity,
        }),
      });

      const data = await r.json();

      if (!r.ok) {
        throw new Error(
          data.error || "Unable to start payment."
        );
      }

      if (!data.authorization_url) {
        throw new Error(
          "Paystack payment link was not received."
        );
      }

      /*
       * Send the voter to Paystack.
       *
       * Paystack will handle the actual payment.
       */
      window.location.href = data.authorization_url;
    } catch (error: any) {
      setMessage(
        error?.message ||
          "Something went wrong."
      );

      setBusy(false);
    }
  }

  return (
    <>
      {/* =========================
          NAVBAR
      ========================= */}

      <nav className="navbar">
        <div className="nav-inner">

          <div className="brand">

            <div className="brand-mark">
              N
            </div>

            <div>
              <div className="brand-title">
                NiMSA
              </div>

              <div className="brand-subtitle">
                ASCLEPIUS AWARDS 2026
              </div>
            </div>

          </div>

          <div className="nav-links">

            <a href="#categories">
              Awards
            </a>

            <a href="#leaderboard">
              Results
            </a>

          </div>

        </div>
      </nav>


      {/* =========================
          HERO
      ========================= */}

      <header className="hero-awards">

        <div className="hero-overlay" />

        <div className="hero-decoration">
          <div />
          <div />
          <div />
        </div>

        <div className="hero-content">

          <div className="hero-badge">
            NiMSA PRESENTS
          </div>

          <p className="hero-small">
            ASCLEPIUS
          </p>

          <h1>
            Awards <span>2026</span>
          </h1>

          <p className="hero-description">
            Celebrating exceptional personalities,
            leadership, service, innovation and
            outstanding contributions to the
            Nigerian medical student community.
          </p>

          <a
            href="#categories"
            className="hero-button"
          >
            VOTE NOW →
          </a>

        </div>

      </header>


      {/* =========================
          INTRO
      ========================= */}

      <section className="intro-section">

        <div className="section-container">

          <div className="gold-line" />

          <p className="eyebrow">
            THE AWARDS
          </p>

          <h2>
            Celebrating Excellence
          </h2>

          <p className="intro-text">
            The Asclepius Awards 2026,
            proudly under NiMSA, recognizes
            personalities who have demonstrated
            excellence, influence, service,
            leadership and creativity.
          </p>

        </div>

      </section>


      {/* =========================
          CATEGORIES
      ========================= */}

      <section
        className="categories-section"
        id="categories"
      >

        <div className="section-container">

          <div className="section-heading">

            <div>

              <p className="eyebrow">
                NOMINATIONS
              </p>

              <h2>
                Choose Your Nominee
              </h2>

            </div>

            <p>
              Select a category and support
              your preferred personality.
              Each vote costs ₦100.
            </p>

          </div>


          <div className="category-list">

            {categories.map(
              (category, categoryIndex) => {

                const categoryNominees =
                  nominees.filter(
                    n =>
                      n.category_id ===
                      category.id
                  );

                return (

                  <section
                    className="category-block"
                    key={category.id}
                  >

                    <div className="category-header">

                      <div className="category-number">
                        {String(
                          categoryIndex + 1
                        ).padStart(2, "0")}
                      </div>

                      <div>

                        <p className="category-label">
                          AWARD CATEGORY
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
                        No nominees available
                        yet.
                      </div>

                    ) : (

                      <div className="nominee-grid">

                        {categoryNominees.map(
                          (nominee, nomineeIndex) => (

                            <article
                              className="nominee-card"
                              key={nominee.id}
                            >

                              <div className="nominee-image">

                                {nominee.photo_url ? (

                                  <img
                                    src={
                                      nominee.photo_url
                                    }
                                    alt={
                                      nominee.name
                                    }
                                  />

                                ) : (

                                  <div className="no-photo">
                                    {nominee.name
                                      .charAt(0)
                                      .toUpperCase()}
                                  </div>

                                )}

                                <div className="nominee-number">
                                  NOMINEE{" "}
                                  {String(
                                    nomineeIndex + 1
                                  ).padStart(2, "0")}
                                </div>

                              </div>


                              <div className="nominee-content">

                                <h4>
                                  {nominee.name}
                                </h4>

                                <p>
                                  {nominee.bio ||
                                    "Outstanding nominee."}
                                </p>

                                <button
                                  className="nominee-vote"
                                  onClick={() =>
                                    openVote(
                                      nominee
                                    )
                                  }
                                >

                                  <span>
                                    VOTE FOR{" "}
                                    {nominee.name}
                                  </span>

                                  <strong>
                                    →
                                  </strong>

                                </button>

                              </div>

                            </article>

                          )
                        )}

                      </div>

                    )}

                  </section>

                );
              }
            )}

          </div>

        </div>

      </section>


      {/* =========================
          LEADERBOARD
      ========================= */}

      <section
        className="leaderboard-section"
        id="leaderboard"
      >

        <div className="section-container">

          <div className="leaderboard-heading">

            <div className="gold-line" />

            <p className="eyebrow">
              LIVE RESULTS
            </p>

            <h2>
              Current Leaderboard
            </h2>

            <p>
              Results update as verified votes
              are received.
            </p>

          </div>


          <div className="leaderboard">

            {categories.map(category => {

              const list =
                results
                  .filter(
                    x =>
                      x.category_id ===
                      category.id
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

                    list.map((x, i) => (

                      <div
                        className="leader-row"
                        key={x.id}
                      >

                        <span className="rank">
                          #{i + 1}
                        </span>

                        {x.photo_url ? (

                          <img
                            src={x.photo_url}
                            alt={x.name}
                          />

                        ) : (

                          <div className="leader-avatar">
                            {x.name
                              .charAt(0)
                              .toUpperCase()}
                          </div>

                        )}

                        <div className="leader-name">

                          <strong>
                            {x.name}
                          </strong>

                          <span>
                            NOMINEE
                          </span>

                        </div>

                        <div className="vote-count">

                          <strong>
                            {x.votes}
                          </strong>

                          <span>
                            VOTES
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


      {/* =========================
          VOTE MODAL
      ========================= */}

      {selected && (

        <div className="modal-backdrop">

          <div className="vote-modal">

            <button
              className="modal-close"
              onClick={closeVote}
              disabled={busy}
            >
              ×
            </button>


            <div className="modal-label">
              ASCLEPIUS AWARDS 2026
            </div>


            <h2>
              Vote for{" "}
              <span>
                {selected.name}
              </span>
            </h2>


            <p className="modal-category">

              {
                categories.find(
                  c =>
                    c.id ===
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
              Each vote costs <strong>₦100</strong>.
              Select how many votes you want to
              purchase.
            </p>


            <label>
              Number of votes
            </label>

            <input
              className="email-input"
              type="number"
              min="1"
              max="1000"
              value={quantity}
              onChange={e =>
                setQuantity(
                  Math.max(
                    1,
                    Math.min(
                      1000,
                      Number(e.target.value)
                    )
                  )
                )
              }
            />


            <div
              style={{
                marginTop: 15,
                padding: 15,
                background: "white",
                border: "1px solid #dedbd2",
                display: "flex",
                justifyContent:
                  "space-between",
                alignItems: "center",
              }}
            >

              <span>
                Total
              </span>

              <strong
                style={{
                  fontSize: 24,
                  color: "#063c2c",
                }}
              >
                ₦
                {totalAmount.toLocaleString()}
              </strong>

            </div>


            <label
              style={{
                display: "block",
                marginTop: 20,
              }}
            >
              Email
            </label>

            <input
              className="email-input"
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={e =>
                setEmail(
                  e.target.value
                )
              }
            />


            {message && (

              <div
                className={
                  "modal-message " +
                  (message.includes(
                    "success"
                  )
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
              onClick={startPayment}
            >

              {busy
                ? "REDIRECTING TO PAYSTACK..."
                : `PAY ₦${totalAmount.toLocaleString()} & VOTE`}

            </button>


            <p className="modal-note">
              You will be securely redirected
              to Paystack to complete your payment.
            </p>

          </div>

        </div>

      )}


      {/* =========================
          FOOTER
      ========================= */}

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
                Asclepius Awards 2026
              </span>

            </div>

          </div>

          <p>
            Celebrating excellence within the
            Nigerian Medical Students' Association.
          </p>

          <div className="footer-bottom">
            © 2026 NiMSA • Asclepius Awards
          </div>

        </div>

      </footer>
    </>
  );
}
