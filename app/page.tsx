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

export default function Home() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [nominees, setNominees] = useState<Nominee[]>([]);

  const [selected, setSelected] =
    useState<Nominee | null>(null);

  // Controls which award category is currently open.
  // null means all categories are closed.
  const [expandedCategory, setExpandedCategory] =
    useState<string | null>(null);

  const [email, setEmail] = useState("");

  const [quantity, setQuantity] =
    useState("1");

  const [message, setMessage] =
    useState("");

  const [busy, setBusy] =
    useState(false);

  const VOTE_PRICE = 100;

  const quantityNumber =
    Number(quantity);

  const totalAmount =
    Number.isInteger(quantityNumber) &&
    quantityNumber >= 1
      ? quantityNumber * VOTE_PRICE
      : 0;

  // =====================================
  // LOAD CATEGORIES AND NOMINEES
  // =====================================

  async function load() {
    try {
      const r = await fetch(
        "/api/categories"
      );

      const data = await r.json();

      setCategories(
        data.categories || []
      );

      setNominees(
        data.nominees || []
      );
    } catch {
      setMessage(
        "Unable to load voting data."
      );
    }
  }

  useEffect(() => {
    load();
  }, []);

  // =====================================
  // OPEN VOTE MODAL
  // =====================================

  function openVote(
    nominee: Nominee
  ) {
    setSelected(nominee);
    setEmail("");
    setQuantity("1");
    setMessage("");
  }

  // =====================================
  // CLOSE VOTE MODAL
  // =====================================

  function closeVote() {
    if (busy) return;

    setSelected(null);
    setEmail("");
    setQuantity("1");
    setMessage("");
  }

  // =====================================
  // START PAYMENT
  // =====================================

  async function startPayment() {
    if (!selected) {
      return;
    }

    if (!email.trim()) {
      setMessage(
        "Please enter your email."
      );
      return;
    }

    if (!email.includes("@")) {
      setMessage(
        "Please enter a valid email."
      );
      return;
    }

    const voteQuantity =
      Number(quantity);

    if (
      !Number.isInteger(
        voteQuantity
      ) ||
      voteQuantity < 1 ||
      voteQuantity > 1000
    ) {
      setMessage(
        "Please enter between 1 and 1000 whole votes."
      );
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      const r = await fetch(
        "/api/payment/initialize",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            nomineeId:
              selected.id,

            email:
              email
                .trim()
                .toLowerCase(),

            quantity:
              voteQuantity,
          }),
        }
      );

      const data =
        await r.json();

      if (!r.ok) {
        throw new Error(
          data.error ||
            "Unable to start payment."
        );
      }

      if (
        !data.authorization_url
      ) {
        throw new Error(
          "Paystack payment link was not received."
        );
      }

      // Redirect voter to Paystack
      window.location.href =
        data.authorization_url;
    } catch (error: any) {
      setMessage(
        error?.message ||
          "Something went wrong."
      );

      setBusy(false);
    }
  }

  // =====================================
  // TOGGLE CATEGORY
  // =====================================

  function toggleCategory(
    categoryId: string
  ) {
    setExpandedCategory(
      current =>
        current === categoryId
          ? null
          : categoryId
    );
  }

  return (
    <>
      {/* =================================
          NAVBAR
      ================================= */}

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


      {/* =================================
          HERO
      ================================= */}

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
            Awards{" "}
            <span>2026</span>
          </h1>

          <p className="hero-description">
            Celebrating exceptional
            personalities, leadership,
            service, innovation and
            outstanding contributions
            to the Nigerian medical
            student community.
          </p>

          <a
            href="#categories"
            className="hero-button"
          >
            VOTE NOW →
          </a>

        </div>

      </header>


      {/* =================================
          INTRO
      ================================= */}

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
            proudly under NiMSA,
            recognizes personalities
            who have demonstrated
            excellence, influence,
            service, leadership and
            creativity.
          </p>

        </div>

      </section>


      {/* =================================
          CATEGORIES
      ================================= */}

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
              Select an award category
              to view its nominees and
              support your preferred
              personality. Each vote
              costs ₦100.
            </p>

          </div>


          {/* =================================
              CATEGORY LIST
          ================================= */}

          <div className="category-list">

            {categories.map(
              (
                category,
                categoryIndex
              ) => {

                const categoryNominees =
                  nominees.filter(
                    nominee =>
                      nominee.category_id ===
                      category.id
                  );

                const isExpanded =
                  expandedCategory ===
                  category.id;

                return (

                  <section
                    className="category-block"
                    key={
                      category.id
                    }
                  >

                    {/* =================================
                        CATEGORY HEADER
                    ================================= */}

                    <div
                      className="category-header"
                      onClick={() =>
                        toggleCategory(
                          category.id
                        )
                      }
                      style={{
                        cursor:
                          "pointer",
                      }}
                    >

                      <div className="category-number">
                        {String(
                          categoryIndex +
                            1
                        ).padStart(
                          2,
                          "0"
                        )}
                      </div>


                      <div
                        style={{
                          flex: 1,
                        }}
                      >

                        <p className="category-label">
                          AWARD CATEGORY
                        </p>

                        <h3>
                          {
                            category.name
                          }
                        </h3>

                        <p>
                          {
                            category.description ||
                            "Choose your preferred nominee."
                          }
                        </p>

                      </div>


                      {/* =================================
                          VIEW NOMINEES BUTTON
                      ================================= */}

                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();

                          toggleCategory(
                            category.id
                          );
                        }}
                        style={{
                          border:
                            "1px solid #d8d2c4",

                          background:
                            isExpanded
                              ? "#063c2c"
                              : "#fff",

                          color:
                            isExpanded
                              ? "#fff"
                              : "#063c2c",

                          padding:
                            "10px 15px",

                          borderRadius:
                            8,

                          fontWeight:
                            800,

                          cursor:
                            "pointer",

                          whiteSpace:
                            "nowrap",
                        }}
                      >
                        {isExpanded
                          ? "HIDE NOMINEES ↑"
                          : "VIEW NOMINEES →"}
                      </button>

                    </div>


                    {/* =================================
                        NOMINEES
                    ================================= */}

                    {isExpanded && (

                      <div
                        style={{
                          marginTop:
                            20,
                        }}
                      >

                        {categoryNominees.length ===
                        0 ? (

                          <div className="empty-nominees">
                            No nominees
                            available
                            yet.
                          </div>

                        ) : (

                          <div className="nominee-grid">

                            {categoryNominees.map(
                              (
                                nominee,
                                nomineeIndex
                              ) => (

                                <article
                                  className="nominee-card"
                                  key={
                                    nominee.id
                                  }
                                >

                                  {/* =================================
                                      NOMINEE PHOTO
                                  ================================= */}

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
                                          .charAt(
                                            0
                                          )
                                          .toUpperCase()}

                                      </div>

                                    )}


                                    <div className="nominee-number">

                                      NOMINEE{" "}

                                      {String(
                                        nomineeIndex +
                                          1
                                      ).padStart(
                                        2,
                                        "0"
                                      )}

                                    </div>

                                  </div>


                                  {/* =================================
                                      NOMINEE INFORMATION
                                  ================================= */}

                                  <div className="nominee-content">

                                    <h4>
                                      {
                                        nominee.name
                                      }
                                    </h4>

                                    <p>
                                      {
                                        nominee.bio ||
                                        "Outstanding nominee."
                                      }
                                    </p>


                                    {/* =================================
                                        VOTE BUTTON
                                    ================================= */}

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
                                        {
                                          nominee.name
                                        }
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

                      </div>

                    )}

                  </section>

                );
              }
            )}

          </div>

        </div>

      </section>


      {/* =================================
          LEADERBOARD
          Currently left unchanged/empty.
      ================================= */}

      <section
        id="leaderboard"
        style={{
          display: "none",
        }}
      >
        {/* Your leaderboard can be added here later. */}
      </section>


      {/* =================================
          VOTE MODAL
      ================================= */}

      {selected && (

        <div className="modal-backdrop">

          <div className="vote-modal">

            {/* CLOSE */}

            <button
              className="modal-close"
              onClick={
                closeVote
              }
              disabled={
                busy
              }
            >
              ×
            </button>


            {/* LABEL */}

            <div className="modal-label">
              ASCLEPIUS AWARDS 2026
            </div>


            {/* TITLE */}

            <h2>

              Vote for{" "}

              <span>
                {
                  selected.name
                }
              </span>

            </h2>


            {/* CATEGORY */}

            <p className="modal-category">

              {
                categories.find(
                  category =>
                    category.id ===
                    selected.category_id
                )?.name
              }

            </p>


            {/* PHOTO */}

            {selected.photo_url && (

              <img
                className="modal-photo"
                src={
                  selected.photo_url
                }
                alt={
                  selected.name
                }
              />

            )}


            {/* INSTRUCTION */}

            <p className="modal-instruction">

              Each vote costs{" "}

              <strong>
                ₦100
              </strong>
              .

              Select how many
              votes you want to
              purchase.

            </p>


            {/* QUANTITY */}

            <label>
              Number of votes
            </label>

            <input
              className="email-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={
                quantity
              }
              onChange={e => {

                const value =
                  e.target.value;

                // Allow empty field
                // while typing.
                if (
                  value === ""
                ) {
                  setQuantity(
                    ""
                  );
                  return;
                }

                // Only allow digits.
                if (
                  !/^\d+$/.test(
                    value
                  )
                ) {
                  return;
                }

                const number =
                  Number(
                    value
                  );

                // Maximum 1000 votes.
                if (
                  number >
                  1000
                ) {
                  setQuantity(
                    "1000"
                  );
                  return;
                }

                setQuantity(
                  value
                );

              }}
              onBlur={() => {

                const number =
                  Number(
                    quantity
                  );

                if (
                  !Number.isInteger(
                    number
                  ) ||
                  number < 1
                ) {
                  setQuantity(
                    "1"
                  );
                }

              }}
            />


            {/* TOTAL */}

            <div
              style={{
                marginTop:
                  15,

                padding:
                  15,

                background:
                  "white",

                border:
                  "1px solid #dedbd2",

                display:
                  "flex",

                justifyContent:
                  "space-between",

                alignItems:
                  "center",
              }}
            >

              <span>
                Total
              </span>

              <strong
                style={{
                  fontSize:
                    24,

                  color:
                    "#063c2c",
                }}
              >

                ₦
                {totalAmount.toLocaleString()}

              </strong>

            </div>


            {/* EMAIL */}

            <label
              style={{
                display:
                  "block",

                marginTop:
                  20,
              }}
            >
              Email
            </label>

            <input
              className="email-input"
              type="email"
              placeholder="your@email.com"
              value={
                email
              }
              onChange={e =>
                setEmail(
                  e.target.value
                )
              }
            />


            {/* MESSAGE */}

            {message && (

              <div
                className={
                  "modal-message " +
                  (
                    message.includes(
                      "success"
                    )
                      ? "success"
                      : "error"
                  )
                }
              >
                {
                  message
                }
              </div>

            )}


            {/* PAYMENT */}

            <button
              className="submit-vote"
              disabled={
                busy
              }
              onClick={
                startPayment
              }
            >

              {busy
                ? "REDIRECTING TO PAYSTACK..."
                : `PAY ₦${totalAmount.toLocaleString()} & VOTE`}

            </button>


            {/* NOTE */}

            <p className="modal-note">

              You will be securely
              redirected to
              Paystack to complete
              your payment.

            </p>

          </div>

        </div>

      )}


      {/* =================================
          FOOTER
      ================================= */}

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
            Celebrating excellence
            within the Nigerian
            Medical Students'
            Association.
          </p>


          <div className="footer-bottom">

            © 2026 NiMSA • Asclepius
            Awards

          </div>

        </div>

      </footer>

    </>
  );
}
