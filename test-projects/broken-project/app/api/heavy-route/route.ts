import _ from 'lodash';
import AWS from 'aws-sdk';
import moment from 'moment';

export async function GET() {
  const data = _.map([1, 2, 3], (x) => x * 2);
  console.log('Moment time:', moment().format());
  return Response.json({ data });
}
