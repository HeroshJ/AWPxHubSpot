const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

const HS_API_KEY = process.env.HS_API_KEY; //hs

const hapikeyParam = `hapikey=${HS_API_KEY}`;
const HSconfig = {
  headers: {
    "Access-Control-Allow-Origin": "*",
    Accept: "application/json",
  },
};

const currentYear = new Date().getFullYear();
const today = new Date();
const quarter_days = [
  new Date(`January 1 ${currentYear}`),
  new Date(`April 1 ${currentYear}`),
  new Date(`July 1 ${currentYear}`),
  new Date(`October 1 ${currentYear}`),
];

let end_range = quarter_days.find(
  (quarter) =>
    today.getDate() == quarter.getDate() &&
    today.getMonth() == quarter.getMonth()
);

if (end_range === undefined) return;

//Get start range
let start_range = new Date(
  new Date(end_range).setMonth(end_range.getMonth() - 3)
);

let returnedContacts = {};
let returnedDeals = {};

//Entry Point
getContacts();

async function getContacts(offset) {
  let offsetParam = offset === undefined ? `` : `&vidOffset=${offset}`;

  const propterties = `&formSubmissionMode=none&property=awp_display_name&property=awp_affiliate_id&count=100`;
  const paramsString = `?${hapikeyParam}${propterties}${offsetParam}`;
  const config = {
    headers: {
      "Access-Control-Allow-Origin": "*",
      Accept: "application/json",
    },
  };
  const finalUrl = `https://api.hubapi.com/contacts/v1/lists/1/contacts/all${paramsString}`;
  const res = (await axios.get(finalUrl, config)).data;
  res.contacts.forEach((contact) => {
    returnedContacts = {
      ...returnedContacts,
      [contact.vid]: {
        total_deal_amount: 0,
        display_name: contact.properties.awp_display_name
          ? contact.properties.awp_display_name.value
          : null,
      },
    };
  });
  if (res["has-more"]) {
    getContacts(res["vid-offset"]);
  } else {
    console.log("getting contacts done");
    getDeals();
  }
}

const getDeals = async (offset) => {
  let offsetParam = offset === undefined ? `` : `&offset=${offset}`;

  const propterties = `&formSubmissionMode=none&properties=awp_referral_id&properties=dealstage&limit=250&properties=closedate&properties=dealstage&properties=amount`;
  const paramsString = `?${hapikeyParam}${propterties}${offsetParam}`;
  const config = {
    headers: {
      "Access-Control-Allow-Origin": "*",
      Accept: "application/json",
    },
  };
  const finalUrl = `https://api.hubapi.com/deals/v1/deal/paged${paramsString}`;
  const res = (await axios.get(finalUrl, config)).data;
  res.deals.forEach((el) => {
    if (
      el.properties.awp_referral_id !== undefined &&
      el.properties.closedate.value < end_range &&
      el.properties.closedate.value >= start_range &&
      (el.properties.dealstage.value == 2139958 ||
        el.properties.dealstage.value == 2084696)
    ) {
      returnedDeals[el.properties.awp_referral_id.value] = {
        dealId: el.dealId,
        dealstage: el.properties.dealstage.value,
        amount: parseFloat(el.properties.amount.value),
      };
    }
  });
  if (res.hasMore) {
    getDeals(res.offset);
  } else {
    console.log("getting hubspot deals, done");
    start(Object.keys(returnedDeals), sumDealAmount);
  }
};

const sumDealAmount = async (dealIndex) => {
  const deal = returnedDeals[dealIndex];
  const url = `https://api.hubapi.com/crm-associations/v1/associations/${deal.dealId}/HUBSPOT_DEFINED/3?${hapikeyParam}`;
  try {
    const contact = await axios.get(url, HSconfig);
    const contactVid =
      contact.data.results.length > 0 && contact.data.results[0];
    returnedContacts[contactVid].total_deal_amount += deal.amount;
  } catch (err) {
    console.log(err);
  }
};

/**
 * asyncForEach() and start() are utility functions to allow for time separation between api calls
 * to accomodate for HubSpot rate limits
 */
async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}
const start = async (props, action) => {
  if (props.length < 1) return;
  await asyncForEach(props, async (prop, index) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    prop !== null && action(prop);
    console.log(index);
  });
  console.log(returnedContacts);
  syncContacts();
};

/**
 * Fetch all partners from AWP and Map their properties
 */
const syncContacts = async () => {
  try {
    //map to hubspot data
    const contactProps = [];
    Object.keys(returnedContacts).forEach((contact) => {
      contactProps.push(contact, mapContactProps(returnedContacts[contact]));
    });
    postContacts(contactProps).then((res) => getProducts());
  } catch (err) {
    console.log(err);
  }
};

/**
 * Post the contacts to HubSpot via Batch call
 * This will not create duplicate contacts, but override existing ones based on id/email
 * @param {*} contacts
 */
const postContacts = async (contacts) => {
  const url = `https://api.hubapi.com/contacts/v1/contact/batch?${hapikeyParam}`;
  let config = {
    headers: {
      "Access-Control-Allow-Origin": "*",

      "Content-Type": "application/json",
    },
  };
  try {
    const response = await axios.post(url, contacts, config);
    console.log("partners sync: ", response.status);
  } catch (err) {
    console.log(err.response.data);
  }
};

/**
 * Take AWP contact and map props to HS compatible properties
 * @param {contact obj} contact
 */
const mapContactProps = (vid, contact) => {
  return {
    vid: vid,
    properties: [
      {
        name: "last_90_days_influenced_revenue",
        value: Math.ceil(contact.total_deal_amount * 100) / 100,
      },
    ],
  };
};
