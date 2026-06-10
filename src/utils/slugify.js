'use strict';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(input = '') {
  return String(input)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_REGEX.test(slug);
}

module.exports = { slugify, isValidSlug, SLUG_REGEX };
