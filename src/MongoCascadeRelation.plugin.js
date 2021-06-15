import _ from 'lodash';

async function onCascadeCreate(items, cascade, app) {
  async function addChildToParent(cascade, items) {
    let parent = await app.services[cascade.model].findById(items[0][cascade.parentId]);
    items.forEach((item) => {
      if (parent[cascade.field].indexOf(item._id) < 0) {
        parent[cascade.field].push(item._id);
      }
    });
    await parent.save();
  }

  if (cascade.parent) {
    for (let i=0; i<cascade.parent.length; i++) {
      if (cascade.parent[i].onCreation) {
        if (_.isArray(items)) {
          // group items to optimize creation if they has same parent
          let groupedItems = _.groupBy(items, cascade.parent[i].parentId);
          await Promise.all(Object.keys(groupedItems).map((datasetName) => addChildToParent(cascade.parent[i], groupedItems[datasetName])));
        } else {
          await addChildToParent(cascade.parent[i], [items]);
        }
      }
    }
  }
}

async function __onDeleteForParent(items, cascade, app) {
  if (!cascade.children) return;

  let groupedCascadeChildrenByModel = _.groupBy(cascade.children, 'model');

  await Promise.all(Object.keys(groupedCascadeChildrenByModel).map(model => {
    let ids = _.flatten(groupedCascadeChildrenByModel[model].map((cascade) => items.map(item => item[cascade.childrenId])));
    return app.services[model].deleteMany({_id: { $in: ids }});
  }));
}

async function __onDeleteForChild(items, cascade, app) {
  async function deleteChildFromParent(cascade, items) {
    let itemsIds = items.map(item => item._id.toString());
    let parent = await app.services[cascade.model].findById(items[0][cascade.parentId]);
    
    if (_.isArray(parent[cascade.field])) {
      parent[cascade.field] = _.difference(parent[cascade.field], itemsIds);
    } else {
      parent[cascade.field] = itemsIds.indexOf(parent[cascade.field]) < 0 ? parent[cascade.field] : null;
    }
    
    await parent.save();
  }

  if (cascade.parent) {
    for (let i=0; i<cascade.parent.length; i++) {
      if (cascade.parent[i].onDelete) {
        if (_.isArray(items)) {
          // group items to optimize creation if they has same parent
          let groupedItems = _.groupBy(items, cascade.parent[i].parentId);
          await Promise.all(Object.keys(groupedItems).map((datasetName) => deleteChildFromParent(cascade.parent[i], groupedItems[datasetName])));
        } else {
          await deleteChildFromParent(cascade.parent[i], [items]);
        }
      }
    }
  }
}

async function onCascadeDelete(items, cascade, app) {
  return Promise.all([
    __onDeleteForParent(items, cascade, app),
    __onDeleteForChild(items, cascade, app)
  ])
}

export default (cascade) => {
  return {
    staticMethods: {
      async findByIdAndDelete(id, options = {}) {
          if (this.beforeDelete) await this.beforeDelete(id);
          const result = await this.model.findByIdAndDelete(id);

          if (!options.withoutCascade && result) await onCascadeDelete(result, cascade, this.app);

          if (this.afterDelete) await this.afterDelete(id, result);

          return result;
      },

      async findOneAndDelete(filter = {}, options = {}) {
        if (this.beforeDelete) await this.beforeDelete(filter, options);
        const result = await this.model.findOneAndDelete(filter, options);

        if (!options.withoutCascade && result) await onCascadeDelete(result, cascade, this.app);

        if (this.afterDelete) await this.afterDelete(filter, result);

        return result;
      },
      async deleteMany(filter = {}, options = {}) {
        if (this.beforeDelete) await this.beforeDelete(filter, options);
        let data = await this.model.find(filter, '_id'+(cascade.children ? ' '+cascade.children.map((c) => c.field).join(" "): ''));

        const res = await this.model.deleteMany(filter, options);

        if (!options.withoutCascade && res) await onCascadeDelete(data, cascade, this.app);
        if (this.afterDelete) await this.afterDelete(filter, res);

        return res;
      },
      async deleteOne(filter = {}, options = {}) {
        if (this.beforeDelete) await this.beforeDelete(filter, options);

        let data = await this.model.findOne(filter, '_id'+(cascade.children ? ' '+cascade.children.map((c) => c.field).join(" "): ''));

        const res = await this.model.deleteOne(filter, options);

        if (!options.withoutCascade && res) await onCascadeDelete(data, cascade, this.app);
        if (this.afterDelete) await this.afterDelete(filter, res);

        return res;
      },
      async create(data, options = {}) {
        if (this.beforeCreate) data = await this.beforeCreate(data);
        
        let item;
        try {
            item = await this.model.create(data);
        } catch (e) {
            console.log("class (line : 147) | create | e : ", e);
            throw e;
        }

        if (_.isArray(item)) {
            item = item.map((oneItem) => new this(oneItem.toObject()));
        } else {
            item = new this(item.toObject());
        }

        if (!options.withoutCascade) await onCascadeCreate((_.isArray(item) ? item : [item]), cascade, this.app);
        if (this.afterCreate) await this.afterCreate(data, item);

        return item;
      }
    }
  }
}