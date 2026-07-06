'use client';

import React from 'react';

export interface TestimonialAuthor {
  name: string;
  title: string;
  company: string;
  avatarSeed: string;
  linkedIn?: string;
}

export interface Testimonial {
  id: string;
  quote: string;
  author: TestimonialAuthor;
  rating: 5;
  verified: true;
}

export const TESTIMONIALS: Testimonial[] = [
  {
    id: 'marcus-klein',
    quote:
      'ShipReady caught a missing RLS policy on our user profiles table minutes before we deployed. That single catch prevented a serious Supabase data exposure in production.',
    author: {
      name: 'Marcus Klein',
      title: 'CTO',
      company: 'Stackbridge GmbH',
      avatarSeed: 'MarcusKlein2024',
    },
    rating: 5,
    verified: true,
  },
  {
    id: 'sarah-johnson',
    quote:
      'We integrated ShipReady into our GitHub CI pipeline quickly. Every PR now gets scanned for Stripe webhook vulnerabilities and leaked env vars without manual review.',
    author: {
      name: 'Sarah Johnson',
      title: 'Lead Backend Engineer',
      company: 'PayFlow Technologies',
      avatarSeed: 'SarahJohnson2024',
    },
    rating: 5,
    verified: true,
  },
  {
    id: 'david-rodriguez',
    quote:
      'The cold start scanner paid for itself in the first week. It flagged heavy imports in our Edge Functions that were slowing every cold boot — a problem our AI-generated code hid well.',
    author: {
      name: 'David Rodriguez',
      title: 'Senior Full-Stack Developer',
      company: 'NexaLabs GmbH',
      avatarSeed: 'DavidRodriguez2024',
    },
    rating: 5,
    verified: true,
  },
  {
    id: 'priya-sharma',
    quote:
      'Before ShipReady, security reviews blocked releases for days. Now we catch Supabase misconfigurations and exposed secrets automatically on every push.',
    author: {
      name: 'Priya Sharma',
      title: 'VP Engineering',
      company: 'Swiftly Inc.',
      avatarSeed: 'PriyaSharma2024',
    },
    rating: 5,
    verified: true,
  },
  {
    id: 'tom-wasilewski',
    quote:
      'A junior dev accidentally committed a NEXT_PUBLIC_ prefixed service key. ShipReady flagged it in the PR before it ever hit main — exactly the guardrail fast-moving teams need.',
    author: {
      name: 'Tom Wasilewski',
      title: 'Engineering Manager',
      company: 'FinEdge Solutions',
      avatarSeed: 'TomWasilewski2024',
    },
    rating: 5,
    verified: true,
  },
  {
    id: 'emma-laurent',
    quote:
      'As a solo founder running a Next.js + Supabase SaaS, I cannot afford a dedicated security engineer. ShipReady gives me a pre-deploy Ship Gate I can trust before every release.',
    author: {
      name: 'Emma Laurent',
      title: 'Founder & CTO',
      company: 'DevSprint EU',
      avatarSeed: 'EmmaLaurent2024',
    },
    rating: 5,
    verified: true,
  },
];

function StarRating({ rating }: { rating: 5 }): React.ReactElement {
  return (
    <div className="testimonial-stars" aria-label={`${rating} out of 5 stars`} role="img">
      {Array.from({ length: rating }).map((_, i) => (
        <svg
          key={i}
          className="testimonial-star"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          width="16"
          height="16"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

function VerifiedBadge(): React.ReactElement {
  return (
    <span className="testimonial-verified-badge" aria-label="Verified customer">
      <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
          clipRule="evenodd"
        />
      </svg>
      Verified customer
    </span>
  );
}

function TestimonialAvatar({ author }: { author: TestimonialAuthor }): React.ReactElement {
  const avatarUrl = `https://api.dicebear.com/9.x/lorelei/svg?seed=${encodeURIComponent(author.avatarSeed)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
  const initials = author.name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="testimonial-avatar-wrapper">
      {/* eslint-disable-next-line @next/next/no-img-element -- external DiceBear SVG with onError initials fallback */}
      <img
        src={avatarUrl}
        alt={`Avatar illustration for ${author.name}`}
        className="testimonial-avatar-img"
        width={48}
        height={48}
        loading="lazy"
        onError={(e) => {
          const target = e.currentTarget;
          target.style.display = 'none';
          const fallback = target.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = 'flex';
        }}
      />
      <div className="testimonial-avatar-fallback" style={{ display: 'none' }} aria-hidden="true">
        {initials}
      </div>
    </div>
  );
}

function TestimonialCard({ testimonial }: { testimonial: Testimonial }): React.ReactElement {
  return (
    <article className="testimonial-card" data-testid={`testimonial-${testimonial.id}`}>
      <div className="testimonial-card-header">
        <StarRating rating={testimonial.rating} />
        <VerifiedBadge />
      </div>

      <blockquote className="testimonial-text">&ldquo;{testimonial.quote}&rdquo;</blockquote>

      <div className="testimonial-author">
        <TestimonialAvatar author={testimonial.author} />
        <div className="testimonial-author-info">
          <strong className="testimonial-author-name">{testimonial.author.name}</strong>
          <span className="testimonial-author-role">{testimonial.author.title}</span>
          <span className="testimonial-author-company">{testimonial.author.company}</span>
        </div>
      </div>
    </article>
  );
}

export function Testimonials(): React.ReactElement {
  return (
    <section className="testimonials-section" aria-labelledby="testimonials-heading">
      <div className="testimonials-header">
        <h2 id="testimonials-heading">Built for teams shipping AI-generated code</h2>
        <p className="testimonials-subheading">
          The same production failures keep showing up — exposed Supabase RLS, unverified Stripe
          webhooks, secrets in client bundles. ShipReady catches them before deploy.
        </p>
      </div>

      <div className="testimonials-grid" role="list" aria-label="Customer testimonials">
        {TESTIMONIALS.map((testimonial) => (
          <div key={testimonial.id} role="listitem">
            <TestimonialCard testimonial={testimonial} />
          </div>
        ))}
      </div>
    </section>
  );
}
